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
            wpid, status = os.waitpid(pid, os.WNOHANG)
            if wpid: break
        except ChildProcessError: break
sys.stdout.write(out.decode("utf-8", "replace").replace("\r", ""))
