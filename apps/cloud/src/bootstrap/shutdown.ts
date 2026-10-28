/** Entry wrappers own process termination; jobs/adapters only report lost ownership. */
export interface ShutdownHost {
  exitCode: string | number | null | undefined;
  exit(code: number): void;
  stderr: { write(message: string): unknown };
}
export const SHUTDOWN_TIMEOUT_MS = 60_000;
export function createShutdown(
  stop: () => Promise<void>,
  host: ShutdownHost = process,
) {
  let stopping: Promise<void> | undefined;
  let fatal = false;
  return (failed = false): Promise<void> => {
    fatal ||= failed;
    if (fatal) host.exitCode = 1;
    return (stopping ??= (async () => {
      // Keep the bound referenced: even a stuck cleanup with no sockets must terminate.
      const timer = setTimeout(() => {
        host.stderr.write("Cloud shutdown timed out\n");
        host.exit(1);
      }, SHUTDOWN_TIMEOUT_MS);
      try {
        await stop();
      } catch {
        fatal = true;
        host.exitCode = 1;
        host.stderr.write("Cloud shutdown failed\n");
      } finally {
        clearTimeout(timer);
      }
      // Explicit exit also closes any orphaned keep-alive handles after fatal cleanup.
      if (fatal) host.exit(1);
    })());
  };
}
