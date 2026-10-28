import { requireCapability } from "./register.js";

/** App-resolved client binding; never take another client's binding from request JSON. */
export interface AuthContext {
  clientRef: string;
  sessionRef?: string;
}
export interface LoginIdentity {
  id: string;
  email: string;
  name: string | null;
  image?: string | null;
  accountStatus: string;
}
export type LoginState =
  | { status: "signed-out" | "expired" }
  | {
      status: "signed-in";
      identity: LoginIdentity;
      expiresAt: string;
      credentialRef: string;
    };
export interface LoginOptions {
  requestId: string;
}
export interface LoginAttempt {
  attemptRef: string;
  activationUrl: string;
  userCode: string;
  expiresAt: string;
  pollIntervalSeconds: number;
}
export type LoginProgress =
  | { status: "pending" | "expired" | "cancelled" }
  | { status: "failed"; code: string }
  /** sessionRef is an app-server credential handle, not a browser JSON DTO. */
  | {
      status: "succeeded";
      sessionRef: string;
      identity: LoginIdentity;
      expiresAt: string;
      credentialRef: string;
    };
export interface AuthRevocation {
  principalId: string;
  credentialRef: string;
}
export interface Auth {
  getLoginState(context: AuthContext): Promise<LoginState>;
  startLogin(
    context: AuthContext,
    options: LoginOptions,
  ): Promise<LoginAttempt>;
  pollLogin(context: AuthContext, attemptRef: string): Promise<LoginProgress>;
  cancelLogin(
    context: AuthContext,
    attemptRef: string,
  ): Promise<{ cancelled: boolean }>;
  logout(context: AuthContext): Promise<void | AuthRevocation>;
}
export const auth: Readonly<Auth> = Object.freeze({
  async getLoginState(context) {
    return requireCapability("auth").getLoginState(context);
  },
  async startLogin(context, options) {
    return requireCapability("auth").startLogin(context, options);
  },
  async pollLogin(context, attemptRef) {
    return requireCapability("auth").pollLogin(context, attemptRef);
  },
  async cancelLogin(context, attemptRef) {
    return requireCapability("auth").cancelLogin(context, attemptRef);
  },
  async logout(context) {
    return requireCapability("auth").logout(context);
  },
} satisfies Auth);
