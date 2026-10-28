import {
  db,
  type LoginIdentity,
  type AccountRecord,
} from "@open-design/bridge";
import type { LegacyPrivacyChoice } from "@open-design/contracts/cloud/legacy-app-config";
import { BizError } from "../errors.js";
export type Actor = Pick<
  AccountRecord,
  "id" | "email" | "name" | "image" | "status"
>;
export function requireActive(user: Actor) {
  if (user.status !== "active") throw new BizError("account_restricted");
}
export async function synchronizeIdentity(
  identity: LoginIdentity,
): Promise<Actor> {
  const row = await db.transaction((tx) =>
    tx.accounts.upsertIdentity({
      id: identity.id,
      auth_user_id: identity.id,
      email: identity.email,
      name: identity.name,
      image: identity.image ?? null,
    }),
  );
  if (["deleting", "deleted"].includes(row.status))
    throw new BizError("unauthorized");
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    image: row.image,
    status:
      identity.accountStatus !== "active" ? identity.accountStatus : row.status,
  };
}
export async function readPrivacy(actor: Actor) {
  return (await db.read().accounts.get(actor.id))?.legacy_privacy ?? {};
}
export async function savePrivacy(actor: Actor, input: LegacyPrivacyChoice) {
  requireActive(actor);
  const choice = {
    ...input,
    installationId: input.telemetry.metrics ? input.installationId : null,
  };
  return db.transaction(async (tx) => {
    const account = await tx.accounts.lock(actor.id);
    if (!account) throw new BizError("unauthorized");
    requireActive(account);
    const previous = account.legacy_privacy?.privacyDecisionAt;
    if (typeof previous !== "number" || previous <= choice.privacyDecisionAt)
      await tx.accounts.update(actor.id, { legacy_privacy: choice });
    return (await tx.accounts.get(actor.id))!.legacy_privacy ?? {};
  });
}
