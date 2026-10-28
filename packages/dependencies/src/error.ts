/** Protocol/transport failure. Independent of application HTTP and bridge contracts. */
export class DependencyError extends Error {
  constructor(readonly code: string, readonly uncertain = false, readonly requestId?: string) {
    super(code);
    this.name = 'DependencyError';
  }
}

export class HttpFailure extends DependencyError {
  constructor(readonly status: number, code: string, uncertain = false, requestId?: string) {
    super(code, uncertain, requestId);
  }
}
