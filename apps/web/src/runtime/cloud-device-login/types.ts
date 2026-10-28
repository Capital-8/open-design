export type LoginBrowser = Pick<Window, 'open' | 'location'>;
export interface DeviceLogin {
  begin(): number | undefined;
  isCurrent(attempt?: number): boolean;
  activate(value?: string, attempt?: number): void;
  finish(): boolean;
  close(attempt?: number): void;
}
export type CreateDeviceLogin = (browser?: LoginBrowser) => DeviceLogin;
