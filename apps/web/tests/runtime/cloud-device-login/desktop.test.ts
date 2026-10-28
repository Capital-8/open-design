import { expect, it, vi } from 'vitest';
import { createCloudDeviceLogin } from '../../../src/runtime/cloud-device-login/desktop';

const activation = 'https://open-design.powerformer.net/cloud/cli/activate?deviceId=test&userCode=ABC123';
function fixture(blocked = false, create = createCloudDeviceLogin) {
  const popup = { opener: {}, closed: false, close: vi.fn(), location: { replace: vi.fn() } };
  const browser = { open: vi.fn(() => blocked ? null : popup), location: { replace: vi.fn() } };
  return { popup, browser, login: create(browser as unknown as Window) };
}
it('leaves the desktop authorization lifecycle to the local daemon and host', () => {
  const { login, browser } = fixture();
  login.begin(); login.activate(activation);
  expect(login.finish()).toBe(false);
  expect(browser.open).not.toHaveBeenCalled();
  expect(browser.location.replace).not.toHaveBeenCalled();
});
