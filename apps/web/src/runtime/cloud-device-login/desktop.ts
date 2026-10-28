import type { CreateDeviceLogin } from './types';

/** The local daemon/host already owns device authorization and navigation. */
export const createCloudDeviceLogin: CreateDeviceLogin = () => ({
  begin: () => undefined,
  isCurrent: () => true,
  activate: () => {},
  finish: () => false,
  close: () => {},
});
