import { describe, expect, test } from 'vitest';

import { resolveVitestToolsDevEnv } from '@/vitest/suite';

describe('Vitest tools-dev runtime environment', () => {
  test('pins the fake Codex transport while preserving explicit overrides', () => {
    expect(resolveVitestToolsDevEnv()).toMatchObject({
      OD_CODEX_TRANSPORT: 'exec-json',
      OD_WEB_DEV_BUNDLER: 'turbopack',
    });
    expect(resolveVitestToolsDevEnv({ OD_CODEX_TRANSPORT: 'app-server' })).toMatchObject({
      OD_CODEX_TRANSPORT: 'app-server',
    });
    expect(resolveVitestToolsDevEnv({ OD_WEB_DEV_BUNDLER: 'webpack' }).OD_WEB_DEV_BUNDLER).toBe('webpack');
  });
});
