/**
 * Just enough SMTP (RFC 5321) for nodemailer: EHLO, MAIL, RCPT, DATA, QUIT.
 * Used by the integration tests (password recovery over a real SMTP
 * conversation) and by the end-to-end suite, whose server delivers
 * verification codes to it instead of a real provider.
 */
import { createServer, type Server, type Socket } from 'node:net';

export interface Received {
  from: string;
  to: string[];
  data: string;
}

export function fakeSmtp(opts: { rejectRcpt?: boolean; onMessage?: (m: Received) => void; port?: number } = {}) {
  const inbox: Received[] = [];
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket: Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let buffer = '';
    let inData = false;
    let current: Received = { from: '', to: [], data: '' };
    const reply = (line: string) => socket.write(`${line}\r\n`);
    reply('220 fake.test ESMTP');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      for (;;) {
        if (inData) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end === -1) return;
          current.data = buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          inData = false;
          inbox.push(current);
          opts.onMessage?.(current);
          current = { from: '', to: [], data: '' };
          reply('250 2.0.0 queued');
          continue;
        }
        const nl = buffer.indexOf('\r\n');
        if (nl === -1) return;
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 2);
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO' || cmd === 'HELO') reply('250 fake.test');
        else if (cmd === 'MAIL') {
          current.from = line;
          reply('250 2.1.0 ok');
        } else if (cmd === 'RCPT') {
          if (opts.rejectRcpt) reply('550 5.1.1 mailbox unavailable');
          else {
            current.to.push(line);
            reply('250 2.1.5 ok');
          }
        } else if (cmd === 'DATA') {
          inData = true;
          reply('354 end with <CRLF>.<CRLF>');
        } else if (cmd === 'RSET' || cmd === 'NOOP') reply('250 ok');
        else if (cmd === 'QUIT') {
          reply('221 bye');
          socket.end();
        } else reply('502 not implemented');
      }
    });
  });
  return {
    inbox,
    async start(): Promise<number> {
      await new Promise<void>((r) => server.listen(opts.port ?? 0, '127.0.0.1', () => r()));
      return (server.address() as { port: number }).port;
    },
    stop: () =>
      new Promise<void>((r) => {
        for (const s of sockets) s.destroy();
        server.close(() => r());
      }),
  };
}

/** Decodes quoted-printable soft breaks and "=3D" so links and codes can be searched for. */
export function plainBody(message: Received): string {
  return message.data.replace(/=\r\n/g, '').replace(/=3D/g, '=');
}
