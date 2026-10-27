import net from "net";

/**
 * Tiny in-process SMTP server for e2e specs that need a real delivery.
 *
 * Point an org's own SMTP settings at it (host 127.0.0.1, the returned port,
 * any user/pass): the send path then runs exactly as in production — the
 * connected-mailbox selector, nodemailer, the attempt row — and the spec
 * reads the delivered message back. Accepts any AUTH, never offers STARTTLS,
 * keeps every message in memory.
 */
export interface SinkMessage {
  from: string;
  to: string[];
  /** Raw DATA payload (headers + MIME body), dot-unstuffed. */
  raw: string;
}

export interface SmtpSink {
  port: number;
  messages: SinkMessage[];
  /** Resolves with the first message addressed to `to`, waiting up to `timeoutMs`. */
  waitFor(to: string, timeoutMs?: number): Promise<SinkMessage>;
  close(): Promise<void>;
}

export async function startSmtpSink(): Promise<SmtpSink> {
  const messages: SinkMessage[] = [];
  const sockets = new Set<net.Socket>();

  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);
    let buf = "";
    let mode: "cmd" | "data" | "auth-user" | "auth-pass" = "cmd";
    let from = "";
    let to: string[] = [];
    const reply = (line: string) => socket.write(`${line}\r\n`);
    reply("220 sink.test ESMTP");

    socket.on("data", (chunk) => {
      buf += chunk.toString("latin1");
      for (;;) {
        if (mode === "data") {
          const end = buf.indexOf("\r\n.\r\n");
          if (end < 0) return;
          const raw = buf.slice(0, end).replace(/\r\n\.\./g, "\r\n.");
          buf = buf.slice(end + 5);
          messages.push({ from, to, raw });
          from = "";
          to = [];
          mode = "cmd";
          reply("250 OK queued");
          continue;
        }
        const nl = buf.indexOf("\r\n");
        if (nl < 0) return;
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        if (mode === "auth-user") { mode = "auth-pass"; reply("334 UGFzc3dvcmQ6"); continue; }
        if (mode === "auth-pass") { mode = "cmd"; reply("235 Authenticated"); continue; }
        const verb = line.slice(0, 4).toUpperCase();
        if (verb === "EHLO") {
          reply("250-sink.test");
          reply("250-AUTH PLAIN LOGIN");
          reply("250 8BITMIME");
        } else if (verb === "HELO") {
          reply("250 sink.test");
        } else if (verb === "AUTH") {
          if (/^AUTH LOGIN/i.test(line)) { mode = "auth-user"; reply("334 VXNlcm5hbWU6"); }
          else reply("235 Authenticated");
        } else if (verb === "MAIL") {
          from = (/<([^>]*)>/.exec(line)?.[1]) ?? "";
          reply("250 OK");
        } else if (verb === "RCPT") {
          to.push((/<([^>]*)>/.exec(line)?.[1]) ?? "");
          reply("250 OK");
        } else if (verb === "DATA") {
          mode = "data";
          reply("354 End data with <CR><LF>.<CR><LF>");
        } else if (verb === "QUIT") {
          reply("221 Bye");
          socket.end();
        } else {
          reply("250 OK");
        }
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;

  return {
    port,
    messages,
    async waitFor(to, timeoutMs = 10_000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const m = messages.find((msg) => msg.to.includes(to));
        if (m) return m;
        if (Date.now() > deadline) throw new Error(`[smtp-sink] no message to ${to} within ${timeoutMs}ms`);
        await new Promise((r) => setTimeout(r, 100));
      }
    },
    close() {
      for (const s of sockets) s.destroy();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

/** Decode a quoted-printable body part (soft line breaks + =XX escapes). */
export function decodeQuotedPrintable(s: string): string {
  const bytes = s
    .replace(/=\r\n/g, "")
    .replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  return Buffer.from(bytes, "latin1").toString("utf8");
}

/** The text/html part of a raw message, decoded (quoted-printable, base64 or plain). */
export function htmlPartOf(raw: string): string {
  const parts = raw.split(/\r\n--[^\r\n]+\r\n/);
  for (const part of parts) {
    const sep = part.indexOf("\r\n\r\n");
    if (sep < 0) continue;
    const headers = part.slice(0, sep);
    if (!/content-type:\s*text\/html/i.test(headers)) continue;
    let body = part.slice(sep + 4).replace(/\r\n--[^\r\n]+--\s*$/, "");
    if (/content-transfer-encoding:\s*quoted-printable/i.test(headers)) body = decodeQuotedPrintable(body);
    else if (/content-transfer-encoding:\s*base64/i.test(headers)) body = Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
    return body;
  }
  throw new Error("[smtp-sink] message has no text/html part");
}
