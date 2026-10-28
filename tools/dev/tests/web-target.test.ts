import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveToolDevConfig, resolveToolDevWebTarget } from '../src/config.js';

describe('frontend target selection', () => {
  it('keeps the existing desktop default and rejects unknown targets', () => {
    assert.equal(resolveToolDevWebTarget(undefined), 'desktop');
    assert.equal(resolveToolDevWebTarget('web'), 'web');
    assert.throws(() => resolveToolDevWebTarget('cloud'), /desktop or web/);
    assert.throws(() => resolveToolDevWebTarget(''), /desktop or web/);
  });

  it('isolates target output and generated types within a namespace', () => {
    const desktop = resolveToolDevConfig({ namespace: 'target-test', webTarget: 'desktop' });
    const web = resolveToolDevConfig({ namespace: 'target-test', webTarget: 'web' });
    assert.equal(desktop.namespace, web.namespace);
    assert.notEqual(desktop.apps.web.nextDistDir, web.apps.web.nextDistDir);
    assert.notEqual(desktop.apps.web.nextTsconfigPath, web.apps.web.nextTsconfigPath);
    assert.match(desktop.apps.web.nextDistDir, /desktop[/\\]next$/);
    assert.match(web.apps.web.nextDistDir, /web[/\\]next$/);
    assert.equal(desktop.apps.daemon.sidecarEntryPath, web.apps.daemon.sidecarEntryPath);
  });
});
