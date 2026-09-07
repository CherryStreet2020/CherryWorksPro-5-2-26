#!/usr/bin/env python3
# Run a command under a pseudo-terminal and exit with ITS status.
# `az containerapp exec` refuses to run without a tty, so prod SQL one-liners go
# through here (see docs/DEPLOY.md). Output is buffered and printed once the
# child exits, on purpose: the pty's CR/LF translation is stripped in one place,
# and the payloads are tiny (the exec websocket URL 404s on scripts of roughly
# a kilobyte or more anyway). A 110 s deadline terminates a wedged child.
import os, pty, sys, select, time
cmd = sys.argv[1:]
if not cmd:
    sys.stderr.write("usage: exec-pty.py <command> [args...]\n  runs the command under a pty, prints its output on exit, exits with its status (124 on the 110 s deadline)\n")
    sys.exit(2)
pid, fd = pty.fork()
if pid == 0:
    os.execvp(cmd[0], cmd)
out = b""
deadline = time.time() + 110
while time.time() < deadline:
    r, _, _ = select.select([fd], [], [], 1)
    if fd in r:
        try:
            data = os.read(fd, 65536)
        except OSError:
            break
        if not data: break
        out += data
    else:
        try:
            wpid, _st = os.waitpid(pid, os.WNOHANG)
        except ChildProcessError:
            break
        if wpid:
            # The child exited (already reaped here). Output it wrote between the
            # last read and its exit is still in the pty buffer: drain until EOF
            # or a quiet 200 ms, otherwise the tail of the output is lost.
            exited_status = _st
            while True:
                r, _, _ = select.select([fd], [], [], 0.2)
                if fd not in r: break
                try:
                    data = os.read(fd, 65536)
                except OSError:
                    break
                if not data: break
                out += data
            break
timed_out = time.time() >= deadline and "exited_status" not in dir()
if timed_out:
    # Enforce the deadline: stop the child so a still-writing process cannot wedge the PTY.
    import signal
    try: os.kill(pid, signal.SIGTERM)
    except ProcessLookupError: pass
    for _ in range(20):
        try:
            w, st = os.waitpid(pid, os.WNOHANG)
        except ChildProcessError:
            w, st = pid, 0
        if w: exited_status = st; break
        time.sleep(0.25)
    else:
        try: os.kill(pid, signal.SIGKILL)
        except ProcessLookupError: pass
        try: _, exited_status = os.waitpid(pid, 0)
        except ChildProcessError: exited_status = 0
sys.stdout.write(out.decode("utf-8", "replace").replace("\r", ""))
if timed_out:
    sys.stderr.write("exec-pty: deadline reached; child terminated\n")
    sys.exit(124)
# Reap the child on every path and propagate its status, so a failed command is not reported as success.
try:
    status = exited_status
except NameError:
    # PTY hit EOF before the deadline (child closed its terminal but may still run):
    # keep polling with the same deadline instead of blocking forever.
    status = None
    while time.time() < deadline:
        try:
            w, st = os.waitpid(pid, os.WNOHANG)
        except ChildProcessError:
            w, st = pid, 0
        if w: status = st; break
        time.sleep(0.25)
    if status is None:
        import signal
        try: os.kill(pid, signal.SIGKILL)
        except ProcessLookupError: pass
        try: _, status = os.waitpid(pid, 0)
        except ChildProcessError: status = 0
        sys.stderr.write("exec-pty: deadline reached after PTY EOF; child killed\n")
        sys.exit(124)
if os.WIFEXITED(status):
    sys.exit(os.WEXITSTATUS(status))
sys.exit(128 + os.WTERMSIG(status) if os.WIFSIGNALED(status) else 1)
