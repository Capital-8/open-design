import express from 'express';
import { createHash } from 'node:crypto';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { registerVelaRoutes } from '../src/routes/vela.js';
import { resetDesktopAuthForTests, setDesktopAuthSecret } from '../src/desktop-auth.js';
import type { AppConfigPrefs } from '../src/app-config.js';

const login = vi.hoisted(() => ({ completed: undefined as (() => void) | undefined }));
const identity = vi.hoisted(() => ({ loggedIn: true, sessionState: 'authenticated', user: { id: 'a' } }));
vi.mock('../src/integrations/vela.js', async original => ({
  ...await original<object>(),
  readVelaLoginStatus: () => ({ ...identity }),
  spawnVelaLoginWithFallback: async (deps: { onCompleted?: () => void }) => { login.completed = deps.onCompleted; return { pid: 1 }; },
}));
// The status endpoint's optional model/billing work is outside this test.
vi.mock('../src/agents.js', async original => ({ ...await original<object>(), getAgentDef: () => null }));
const digest = (value: string) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const base64 = (value: string) => Buffer.from(value, 'utf8').toString('base64');

const SHARED = `export const shared = ${JSON.stringify('x'.repeat(4096))};`;
const ENTRY = `import './shared.js'; export function mount(root) { root.textContent = ${JSON.stringify('y'.repeat(4096))}; }`;
const PLACEMENT = 'opend.home.campaign-modal';
const LOCALE = 'en-US';

const manifest = {
  formatVersion: 2,
  runtimeKind: 'web-component',
  runtimeApiVersion: 1,
  platformWrapperVersion: 'vela-touchpoint-wrapper-v1',
  sdkVersion: 'vela-touchpoint-sdk-v1',
  contentLine: 'production',
  placements: [
    {
      key: PLACEMENT,
      entry: 'component.js',
      resources: ['shared.js'],
      locales: [LOCALE],
      requiredCapabilities: [],
      staticActions: [],
    },
  ],
  resources: ['component.js', 'shared.js'],
  images: [],
};

const FULL_RESPONSE = {
  deploymentId: 'deployment-1',
  activityId: 'activity-1',
  snapshotHash: 'sha256:snapshot',
  artifactHash: 'sha256:artifact',
  manifestHash: 'sha256:manifest',
  placementKey: PLACEMENT,
  requiredCapabilities: [],
  staticActions: [],
  testContext: null,
  content: {
    id: 'version-1',
    placementKey: PLACEMENT,
    locale: LOCALE,
    manifest,
    manifestHash: digest(JSON.stringify(manifest)),
    entryPath: 'component.js',
    entryDigest: digest(ENTRY),
    entryModule: ENTRY,
    resources: [
      { path: 'component.js', digest: digest(ENTRY), bytes: base64(ENTRY) },
      { path: 'shared.js', digest: digest(SHARED), bytes: base64(SHARED) },
    ],
    runtime: {
      kind: 'web-component',
      apiVersion: 1,
      wrapperVersion: 'vela-touchpoint-wrapper-v1',
      sdkVersion: 'vela-touchpoint-sdk-v1',
    },
    buildIdentity: { fingerprint: 'fixed' },
  },
  serverTime: '2026-09-18T00:00:00.000Z',
  startsAt: '2026-09-18T00:00:00.000Z',
  endsAt: '2026-09-19T00:00:00.000Z',
  authorizationExpiresAt: '2026-09-18T01:00:00.000Z',
  touchpointDecisionId: 'decision-1',
};


let dir: string;
let upstream: Server;
let daemon: Server;
let lifecycle: ReturnType<typeof registerVelaRoutes>;
let origin: string;
let calls: URL[];
let pending: ServerResponse[];
let config: AppConfigPrefs;
let env: NodeJS.ProcessEnv;
const placement = 'opend.home.campaign-modal';
const headers = { 'x-od-analytics-device-id': 'fixture', 'x-od-analytics-client-type': 'desktop', 'x-od-analytics-locale': 'en-US' };
const listen = async (server: Server) => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
};
const observe = () => fetch(`${origin}/api/integrations/vela/status`, { headers });
const decide = (query = '') => fetch(`${origin}/api/touchpoints/production-runtime?placementKey=${placement}&locale=en-US&emptyResponse=200${query}`);
const untilCalls = async (count: number) => { await vi.waitFor(() => expect(calls).toHaveLength(count)); };
beforeEach(async () => {
  resetDesktopAuthForTests();
  Object.assign(identity, { loggedIn: true, sessionState: 'authenticated', user: { id: 'a' } });
  dir = mkdtempSync(path.join(tmpdir(), 'cms-prefetch-'));
  calls = []; pending = [];
  upstream = createServer((req, res) => { calls.push(new URL(req.url!, 'http://fixture')); pending.push(res); });
  const apiUrl = await listen(upstream);
  env = { VELA_CONTROL_KEY: 'fixture-a', VELA_API_URL: apiUrl, AMR_PROFILE: 'local' };
  config = { telemetry: { metrics: true }, agentCliEnv: {} };
  const app = express();
  app.use(express.json());
  lifecycle = registerVelaRoutes(app, { paths: { RUNTIME_DATA_DIR: dir }, appConfig: { readAppConfig: async () => config }, http: {}, env });
  daemon = createServer(app); origin = await listen(daemon);
});
afterEach(async () => {
  await lifecycle.close();
  daemon.closeAllConnections(); upstream.closeAllConnections();
  await Promise.all([daemon, upstream].map(server => new Promise<void>(resolve => server.close(() => resolve()))));
  resetDesktopAuthForTests();
  rmSync(dir, { recursive: true, force: true });
});
it('starts before home mounts and lets the modal join the same upstream request', async () => {
  setDesktopAuthSecret(Buffer.alloc(32, 1));
  await observe();
  await untilCalls(1);
  const response = decide();
  // A second status read must not launch a duplicate warm request.
  await observe();
  pending[0]!.writeHead(404); pending[0]!.end('{}');
  expect((await response).status).toBe(404);
  expect(calls).toHaveLength(1);
});
it.each(['web', 'signed-out', 'no-consent'] as const)('does not prefetch for %s', async gate => {
  if (gate !== 'web') setDesktopAuthSecret(Buffer.alloc(32, 1));
  if (gate === 'signed-out') Object.assign(identity, { loggedIn: false, sessionState: 'signed_out' });
  if (gate === 'no-consent') config.telemetry = { metrics: false };
  await observe();
  expect(calls).toHaveLength(0);
});
it('aborts an old identity and never hands its result to the new account', async () => {
  setDesktopAuthSecret(Buffer.alloc(32, 1));
  await observe(); await untilCalls(1);
  env.VELA_CONTROL_KEY = 'fixture-b'; identity.user = { id: 'b' };
  await observe(); await untilCalls(2);
  const response = decide();
  await observe(); // Completion barrier: modal request has joined before releasing the body.
  pending[0]!.end('{"old":true}');
  pending[1]!.writeHead(404); pending[1]!.end('{}');
  expect((await response).status).toBe(404);
  expect(calls).toHaveLength(2);
});
it('backs off a failed warm attempt without automatic retry or repeated-status load', async () => {
  setDesktopAuthSecret(Buffer.alloc(32, 1));
  await observe(); await untilCalls(1);
  pending[0]!.writeHead(503); pending[0]!.end('{}');
  await vi.waitFor(() => expect(pending[0]!.writableFinished).toBe(true));
  await observe(); await observe();
  expect(calls).toHaveLength(1);
});
it('keeps active-decision and different-locale queries out of the initial warm flight', async () => {
  setDesktopAuthSecret(Buffer.alloc(32, 1));
  await observe(); await untilCalls(1);
  const response = decide('&activeDecisionId=visible-other');
  await untilCalls(2);
  pending[1]!.writeHead(410); pending[1]!.end('{}');
  expect((await response).status).toBe(410);
  pending[0]!.writeHead(404); pending[0]!.end('{}');
});

function freshDecision() {
  return { ...FULL_RESPONSE, serverTime: new Date().toISOString(), startsAt: new Date(Date.now() - 60_000).toISOString(), endsAt: new Date(Date.now() + 3600_000).toISOString(), authorizationExpiresAt: new Date(Date.now() + 300_000).toISOString() };
}
it('hands a completed warm decision to the first modal locally without a second WAN round trip', async () => {
  setDesktopAuthSecret(Buffer.alloc(32, 1));
  await observe(); await untilCalls(1);
  pending[0]!.end(JSON.stringify(freshDecision()));
  await vi.waitFor(() => expect(pending[0]!.destroyed).toBe(true));
  await observe();
  // Keep an incorrect second dispatch responsive so the red spec fails on behavior.
  upstream.on('request', (_req, res) => { if (calls.length > 1) { res.writeHead(404); res.end('{}'); } });
  const response = await decide();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ content: { id: 'version-1' } });
  expect(calls).toHaveLength(1);
});
it('warms on daemon relaunch with the saved locale, before a status or home request', async () => {
  setDesktopAuthSecret(Buffer.alloc(32, 1));
  await observe(); await untilCalls(1);
  pending[0]!.end(JSON.stringify(freshDecision()));
  await lifecycle.close();
  const app = express();
  lifecycle = registerVelaRoutes(app, { paths: { RUNTIME_DATA_DIR: dir }, appConfig: { readAppConfig: async () => config }, http: {}, env });
  await untilCalls(2);
  expect(calls[1]!.searchParams.get('locale')).toBe('en-US');
  pending[1]!.writeHead(404); pending[1]!.end('{}');
});
it('revoking consent aborts a warm flight before it can cache or publish stale content', async () => {
  setDesktopAuthSecret(Buffer.alloc(32, 1));
  await observe(); await untilCalls(1);
  config.telemetry = { metrics: false };
  await observe();
  await vi.waitFor(() => expect(pending[0]!.destroyed).toBe(true));
  expect(calls).toHaveLength(1);
});

it('starts immediately after login completion without waiting for another renderer status poll', async () => {
  setDesktopAuthSecret(Buffer.alloc(32, 1));
  Object.assign(identity, { loggedIn: false, sessionState: 'signed_out' });
  await observe();
  const response = await fetch(`${origin}/api/integrations/vela/login`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: '{}' });
  expect(response.status).toBe(202);
  Object.assign(identity, { loggedIn: true, sessionState: 'authenticated' });
  expect(login.completed).toBeTypeOf('function');
  login.completed!();
  await untilCalls(1);
  pending[0]!.writeHead(404); pending[0]!.end('{}');
});

it('learns locale from the desktop startup read without analytics identity headers', async () => {
  setDesktopAuthSecret(Buffer.alloc(32, 1));
  await fetch(`${origin}/api/integrations/vela/status`, { headers: { 'x-od-touchpoint-locale': 'en-US' } });
  await untilCalls(1);
  pending[0]!.writeHead(404); pending[0]!.end('{}');
});
it('does not send the first modal back to an AMR already known down during warmup backoff', async () => {
  setDesktopAuthSecret(Buffer.alloc(32, 1));
  await observe(); await untilCalls(1);
  pending[0]!.writeHead(503); pending[0]!.end('{}');
  await vi.waitFor(() => expect(pending[0]!.destroyed).toBe(true));
  await observe();
  upstream.on('request', (_req, res) => { if (calls.length > 1) { res.writeHead(404); res.end('{}'); } });
  expect((await decide()).status).toBe(503);
  expect(calls).toHaveLength(1);
});
