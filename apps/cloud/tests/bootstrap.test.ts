import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CloudResources, CloudModule, ProcessOptions } from '../src/index.js';
import type { RendererOptions } from '../src/renderer-server.js';

const { register } = vi.hoisted(() => ({ register: vi.fn() }));
vi.mock('@open-design/bridge', () => ({ register }));

function setup() {
  const events: string[] = [];
  const resources: CloudResources = {
    bindings: {},
    checkSupport: vi.fn(async () => { events.push('support'); }),
    checkReadiness: vi.fn(async () => { events.push('readiness'); }),
    close: vi.fn(async () => { events.push('resources.close'); }),
  };
  const module = (name: string): CloudModule => ({
    name, required: ['render'],
    start: vi.fn(async () => { events.push(`${name}.start`); return () => { events.push(`${name}.stop`); }; }),
  });
  const first = module('api'), second = module('jobs');
  const createResources = vi.fn(async () => resources);
  return { events, resources, first, second, createResources,
    options: { modules: [first, second], createResources } satisfies ProcessOptions };
}

describe('cloud process bootstrap', () => {
  beforeEach(() => { vi.resetModules(); vi.resetAllMocks(); });

  it('checks structure, support and readiness before starting consumers; shuts down in reverse order once', async () => {
    const { startMain } = await import('../src/server.js');
    const f = setup(); register.mockImplementation(() => { f.events.push('register'); });
    const running = await startMain(f.options);
    expect(f.createResources).toHaveBeenCalledWith(['render']);
    expect(register).toHaveBeenCalledWith({}, { required: ['render'] });
    expect(f.events).toEqual(['register', 'support', 'readiness', 'api.start', 'jobs.start']);
    await Promise.all([running.stop(), running.stop()]);
    expect(f.events.slice(-3)).toEqual(['jobs.stop', 'api.stop', 'resources.close']);
    expect(f.resources.close).toHaveBeenCalledOnce();
    await expect(startMain(f.options)).rejects.toThrow('already attempted');
  });

  it.each(['registration', 'support', 'readiness'] as const)('closes acquired resources on %s failure without starting consumers', async stage => {
    const { startMain } = await import('../src/server.js');
    const f = setup(), error = new Error(stage);
    if (stage === 'registration') register.mockImplementation(() => { throw error; });
    if (stage === 'support') vi.mocked(f.resources.checkSupport).mockRejectedValue(error);
    if (stage === 'readiness') vi.mocked(f.resources.checkReadiness).mockRejectedValue(error);
    await expect(startMain(f.options)).rejects.toBe(error);
    expect(f.first.start).not.toHaveBeenCalled();
    expect(f.resources.close).toHaveBeenCalledOnce();
    if (stage !== 'readiness') expect(f.resources.checkReadiness).not.toHaveBeenCalled();
  });

  it('unwinds started modules after a later module fails and preserves cleanup errors', async () => {
    const { startMain } = await import('../src/server.js');
    const f = setup(), failure = new Error('jobs failed'), cleanup = new Error('connection close failed');
    vi.mocked(f.second.start).mockRejectedValue(failure);
    vi.mocked(f.resources.close).mockRejectedValue(cleanup);
    await expect(startMain(f.options)).rejects.toMatchObject({ errors: [failure, cleanup] });
    expect(f.events).toEqual(['support', 'readiness', 'api.start', 'api.stop']);
  });

  it('does not allow concurrent startup to acquire a second set of resources', async () => {
    const { startMain } = await import('../src/server.js');
    const f = setup();
    const gate = Promise.withResolvers<CloudResources>();
    f.createResources.mockReturnValue(gate.promise);
    const first = startMain(f.options);
    await expect(startMain(f.options)).rejects.toThrow('already attempted');
    gate.resolve(f.resources);
    await (await first).stop();
    expect(f.createResources).toHaveBeenCalledOnce();
  });

  it.each([{ modules: [] }, { modules: [{ name: 'same', required: [] }, { name: 'same', required: [] }] }])
    ('rejects an empty or ambiguous consumer declaration before acquisition', async ({ modules }) => {
      const { startMain } = await import('../src/server.js');
      const f = setup();
      await expect(startMain({ ...f.options, modules: modules.map(module => ({ ...module, start: f.first.start })) }))
        .rejects.toThrow();
      expect(f.createResources).not.toHaveBeenCalled();
    });

  it('renderer declares render only and requires no database or auth environment', async () => {
    const { startRenderer } = await import('../src/renderer-server.js');
    const f = setup();
    const render = { getCapabilities: vi.fn(), render: vi.fn() };
    const running = await startRenderer({
      createResources: async () => ({ ...f.resources, bindings: { render } }), start: f.first.start,
    });
    expect(register).toHaveBeenCalledWith({ render }, { required: ['render'] });
    await running.stop();
  });

  it('renderer rejects unrelated bindings and closes resources before registration', async () => {
    const { startRenderer } = await import('../src/renderer-server.js');
    const f = setup();
    const options = { createResources: async () => ({ ...f.resources, bindings: { db: {} } }), start: f.first.start };
    await expect(startRenderer(options as unknown as RendererOptions)).rejects.toThrow('only the local render');
    expect(f.resources.close).toHaveBeenCalledOnce();
    expect(register).not.toHaveBeenCalled();
  });
});
