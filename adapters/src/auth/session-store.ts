import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import {
  BridgeError,
  type Db,
  type CredentialRecord,
  type SessionRecord,
} from "@open-design/bridge";
export interface CredentialKeyring {
  active: string;
  keys: Readonly<Record<string, Uint8Array>>;
}
export const sessionHash = (ref: string) =>
  createHash("sha256").update(ref).digest("hex");
export function createAuthSessionStore(
  database: Db,
  environment: string,
  keyring: CredentialKeyring,
) {
  if (
    !environment ||
    !keyring.active ||
    !keyring.keys[keyring.active] ||
    Object.values(keyring.keys).some((key) => key.length !== 32)
  )
    throw new TypeError(
      "Stable 32-byte credential encryption keys are required",
    );
  const aad = (
    value: Pick<
      CredentialRecord,
      "id" | "principal_id" | "environment" | "revision"
    >,
  ) =>
    Buffer.from(
      JSON.stringify([
        value.id,
        value.principal_id,
        value.environment,
        value.revision,
      ]),
    );
  function encrypt(secret: string, value: CredentialRecord) {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", keyring.keys[keyring.active]!, iv);
    cipher.setAAD(aad(value));
    return Buffer.concat([
      iv,
      cipher.update(secret, "utf8"),
      cipher.final(),
      cipher.getAuthTag(),
    ]).toString("base64url");
  }
  function decrypt(value: CredentialRecord) {
    const key = keyring.keys[value.key_version];
    if (!key) throw new BridgeError("auth_key_unavailable");
    try {
      const bytes = Buffer.from(value.ciphertext, "base64url");
      const cipher = createDecipheriv(
        "aes-256-gcm",
        key,
        bytes.subarray(0, 12),
      );
      cipher.setAAD(aad(value));
      cipher.setAuthTag(bytes.subarray(-16));
      return Buffer.concat([
        cipher.update(bytes.subarray(12, -16)),
        cipher.final(),
      ]).toString("utf8");
    } catch {
      throw new BridgeError("auth_credential_invalid");
    }
  }
  return {
    environment,
    async save(
      sessionRef: string,
      session: Omit<SessionRecord, "token_hash">,
      credential: Omit<
        CredentialRecord,
        "ciphertext" | "key_version" | "environment"
      >,
      secret: string,
    ) {
      const record: CredentialRecord = {
        ...credential,
        ciphertext: "",
        key_version: keyring.active,
        environment,
      };
      record.ciphertext = encrypt(secret, record);
      await database.transaction(async (tx) => {
        const previous = await tx.sessions.get(sessionHash(sessionRef));
        if (previous) {
          if (
            previous.credential_ref !== record.id ||
            previous.principal_id !== session.principal_id ||
            previous.client_ref !== session.client_ref
          )
            throw new BridgeError("auth_session_conflict");
          return;
        }
        await tx.credentials.insert(record);
        await tx.sessions.insert({
          ...session,
          token_hash: sessionHash(sessionRef),
        });
      });
    },
    session: (ref: string) => database.read().sessions.get(sessionHash(ref)),
    credential: (ref: string) => database.read().credentials.get(ref),
    decrypt,
    async revoke(sessionRef: string, at: number) {
      await database.transaction(async (tx) => {
        const session = await tx.sessions.lock(sessionHash(sessionRef));
        if (!session) return;
        await tx.sessions.revoke(
          session.token_hash,
          new Date(at).toISOString(),
        );
        await tx.credentials.revoke(
          session.credential_ref,
          new Date(at).toISOString(),
          "logout",
        );
      });
    },
  };
}
