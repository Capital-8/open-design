/** A dependency failure, not an HTTP response or a business recovery decision. */
export class BridgeError extends Error {
  constructor(
    readonly code: string,
    readonly uncertain = false,
    readonly requestId?: string,
  ) {
    super(code);
    this.name = 'BridgeError';
  }
}
