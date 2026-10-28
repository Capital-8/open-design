import { createServer, type Server } from "node:http";
import type { Express } from "express";
export async function listen(app: Express, host: string, port: number) {
  const server = createServer(app);
  server.requestTimeout = 330000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  return {
    server,
    async close() {
      await closeServer(server);
    },
  };
}
export async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => server.closeAllConnections(), 5000);
    timer.unref();
    server.close((error) => {
      clearTimeout(timer);
      error ? reject(error) : resolve();
    });
    server.closeIdleConnections();
  });
}
