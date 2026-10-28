import { BridgeError } from '@open-design/bridge';
import { DependencyError, HttpFailure as DependencyHttpFailure } from '@open-design/dependencies';

/** Preserve the existing bridge error shape, including HTTP status used by private auth logic. */
export class HttpFailure extends BridgeError {
  constructor(readonly status: number, code: string, uncertain = false, requestId?: string) {
    super(code, uncertain, requestId);
  }
}

export function toBridgeError(error: unknown): unknown {
  if (error instanceof DependencyHttpFailure) return new HttpFailure(error.status, error.code, error.uncertain, error.requestId);
  if (error instanceof DependencyError) return new BridgeError(error.code, error.uncertain, error.requestId);
  return error;
}

export async function callDependency<T>(call: () => Promise<T>): Promise<T> {
  try { return await call(); } catch (error) { throw toBridgeError(error); }
}

/** A custom transport may already throw bridge failures; keep that injection behavior without a reverse import. */
export function protocolFetch(fetcher: typeof fetch): typeof fetch {
  return async (input, init) => {
    try { return await fetcher(input, init); } catch (error) {
      if (error instanceof HttpFailure) throw new DependencyHttpFailure(error.status, error.code, error.uncertain, error.requestId);
      if (error instanceof BridgeError) throw new DependencyError(error.code, error.uncertain, error.requestId);
      throw error;
    }
  };
}
