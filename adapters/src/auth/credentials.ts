/** Server-only composition dependency, deliberately absent from the bridge API. */
export interface RuntimeCredential {
  controlKey: string;
  providerActorId: string;
  expiresAt: number;
  revision: string;
}
export interface RuntimeCredentialSource {
  resolve(
    credentialRef: string,
    principalId: string,
  ): Promise<RuntimeCredential>;
  isCurrent(
    credentialRef: string,
    revision: string,
  ): boolean | Promise<boolean>;
}
