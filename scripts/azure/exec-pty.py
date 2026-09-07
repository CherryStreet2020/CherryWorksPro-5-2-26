import os, pty, sys, select, time
cmd = sys.argv[1:]
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
            if wpid:
                # child exited: drain what is left, then fall through to the final reap (already reaped here)
                exited_status = _st
                break
        except ChildProcessError: break
sys.stdout.write(out.decode("utf-8", "replace").replace("\r", ""))
# Reap the child on every path and propagate its status, so a failed command is not reported as success.
try:
    status = exited_status
except NameError:
    try:
        _, status = os.waitpid(pid, 0)
    except ChildProcessError:
        status = 0
if os.WIFEXITED(status):
    sys.exit(os.WEXITSTATUS(status))
sys.exit(128 + os.WTERMSIG(status) if os.WIFSIGNALED(status) else 1)
