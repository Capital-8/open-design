// A loopback HTTP CONNECT proxy that only lets a child process reach public
// addresses. yt-dlp makes its own requests and follows its own redirects, so a
// URL-level check before spawning it proves nothing about where it actually
// connects: a permitted entry page can still 3xx, or use an extractor, to reach
// loopback or private space. Pointing the downloader at this proxy moves every
// one of those connections through the same public-address policy the rest of
// the daemon uses.
import { createServer, connect, type Server, type Socket } from 'node:net';
import { assertPublicAssetUrl } from '../public-asset-fetch.js';

export type EgressAllow = (host: string, port: number) => Promise<boolean>;

export interface EgressProxy {
  /** `http://127.0.0.1:<port>` — pass to the child as its proxy. */
  url: string;
  close: () => Promise<void>;
}

const defaultAllow: EgressAllow = async (host, port) => {
  try {
    await assertPublicAssetUrl(`http://${host}:${port}/`);
    return true;
  } catch {
    return false;
  }
};

function splitAuthority(authority: string): { host: string; port: number } | null {
  // [::1]:8080 or host:443 or host
  const v6 = /^\[([^\]]+)\](?::(\d+))?$/.exec(authority);
  if (v6) return { host: v6[1]!, port: Number(v6[2] ?? 443) };
  const m = /^([^:]+)(?::(\d+))?$/.exec(authority);
  if (!m) return null;
  return { host: m[1]!, port: Number(m[2] ?? 443) };
}

/**
 * Start the proxy on 127.0.0.1 and a free port. `allow` decides each
 * destination; a refused target is closed with `407` so the downloader reports
 * a failed download instead of pretending it succeeded.
 */
export async function startEgressProxy(allow: EgressAllow = defaultAllow): Promise<EgressProxy> {
  const server: Server = createServer();
  const sockets = new Set<Socket>();

  const refuse = (socket: Socket) => {
    if (socket.writable) socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
  };

  server.on('connection', (socket: Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());
    let buffered = '';
    const onData = (chunk: Buffer) => {
      buffered += chunk.toString('latin1');
      const end = buffered.indexOf('\r\n\r\n');
      if (end < 0) {
        if (buffered.length > 16 * 1024) refuse(socket);
        return;
      }
      socket.off('data', onData);
      const head = buffered.slice(0, end);
      const rest = buffered.slice(end + 4);
      const [requestLine = ''] = head.split('\r\n');
      const [method, target] = requestLine.split(' ');
      if (!method || !target) return refuse(socket);

      const authority = method.toUpperCase() === 'CONNECT'
        ? target
        : (() => { try { const u = new URL(target); return `${u.hostname}:${u.port || 80}`; } catch { return ''; } })();
      const dest = authority ? splitAuthority(authority) : null;
      if (!dest) return refuse(socket);

      void allow(dest.host, dest.port).then((ok) => {
        if (!ok) return refuse(socket);
        const upstream = connect(dest.port, dest.host, () => {
          if (method.toUpperCase() === 'CONNECT') {
            socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          } else {
            upstream.write(`${head}\r\n\r\n`);
            if (rest) upstream.write(Buffer.from(rest, 'latin1'));
          }
          socket.pipe(upstream);
          upstream.pipe(socket);
        });
        sockets.add(upstream);
        upstream.on('close', () => sockets.delete(upstream));
        upstream.on('error', () => { upstream.destroy(); refuse(socket); });
      }).catch(() => refuse(socket));
    };
    socket.on('data', onData);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
