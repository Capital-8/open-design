export interface AmrSessionRef {
  project: string;
  session: string;
}
export interface AmrRunRef extends AmrSessionRef {
  run: string;
}
export interface AmrRunInput {
  key: string;
  input: string;
  resources?: readonly {
    type: "plugin" | "skill" | "design-system";
    id: string;
  }[];
}
/** Credentials are supplied for this call; the client owns no identity or token cache. */
export type AmrAuthorization = (refresh: boolean) => Promise<string>;

export interface AmrRuntimeClientOptions {
  runtimeUrl: string;
  fetch?: typeof fetch;
}
export interface AmrApiClientOptions<Context> {
  apiUrl: string;
  authorize(context: Context): Promise<string>;
  fetch?: typeof fetch;
}
