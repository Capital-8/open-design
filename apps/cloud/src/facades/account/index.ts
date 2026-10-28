import { auth, type AuthContext } from "@open-design/bridge";
import {
  synchronizeIdentity,
  requireActive,
  readPrivacy,
  savePrivacy,
} from "@open-design/biz/account";
import type { LegacyPrivacyChoice } from "@open-design/contracts/cloud/legacy-app-config";
import { BizError } from "@open-design/biz/errors";
export function createAccountFacade(
  environment: string,
  hooks: {
    revoked?: (principalId: string, credentialRef: string) => Promise<void>;
    loggedIn?: (context: AuthContext) => Promise<void>;
  } = {},
) {
  async function current(context: AuthContext) {
    const state = await auth.getLoginState(context);
    if (state.status !== "signed-in") throw new BizError("unauthorized");
    const user = await synchronizeIdentity(state.identity);
    requireActive(user);
    return {
      user,
      principalId: user.id,
      credentialRef: state.credentialRef,
      environment,
      expiresAt: state.expiresAt,
      auth: context,
    };
  }
  return {
    current,
    start: (context: AuthContext, requestId: string) =>
      auth.startLogin(context, { requestId }),
    async poll(context: AuthContext, ref: string) {
      const progress = await auth.pollLogin(context, ref);
      if (progress.status === "succeeded") {
        requireActive(await synchronizeIdentity(progress.identity));
        await hooks.loggedIn?.({ ...context, sessionRef: progress.sessionRef });
      }
      return progress;
    },
    cancel: (context: AuthContext, ref: string) =>
      auth.cancelLogin(context, ref),
    async logout(context: AuthContext) {
      const receipt = await auth.logout(context);
      if (receipt)
        await hooks.revoked?.(receipt.principalId, receipt.credentialRef);
    },
    async privacy(context: AuthContext) {
      return readPrivacy((await current(context)).user);
    },
    async savePrivacy(context: AuthContext, value: LegacyPrivacyChoice) {
      return savePrivacy((await current(context)).user, value);
    },
  };
}
export type AccountFacade = ReturnType<typeof createAccountFacade>;
export type CloudIdentity = Awaited<ReturnType<AccountFacade["current"]>>;
