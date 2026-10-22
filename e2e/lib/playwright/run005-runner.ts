import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { readFundingRuntimeFixture } from './workspace-funding-fixture.ts';
import { verifyFundingLease, withFundingLease } from './workspace-funding-lease.ts';
import { runFundingCommand } from './funding-runner.ts';

const fixture = await readFundingRuntimeFixture();
const evidence = process.env.OD_RUN005_EVIDENCE_DIR;
if (!evidence || !isAbsolute(evidence)) throw new Error('Absolute RUN005 evidence directory required');
await mkdir(evidence, { recursive: false, mode: 0o700 });
const receipts: unknown[] = [];
let exitCode: number | null = null;
try {
  await withFundingLease(async phase => {
    const verified = await verifyFundingLease(fixture, phase === 'pre' ? 720_000 : 0);
    receipts.push({ phase, ...verified.safe });
  }, async () => {
    const pre = await verifyFundingLease(fixture, 720_000);
    const cmd = await runFundingCommand(
      ['pnpm', 'exec', 'playwright', 'test', '-c', 'lib/playwright/run005.config.ts'],
      new URL('../..', import.meta.url).pathname,
      { ...process.env, ...pre.env, OD_FUNDING_OWNER_RUNNER: 'active' },
      join(evidence, 'playwright.private.log'),
    );
    receipts.push({ command: ['corepack', 'pnpm', 'exec', 'playwright', 'test', '-c', 'lib/playwright/run005.config.ts'], result: cmd });
    exitCode = cmd.exitCode;
  });
} finally {
  await writeFile(join(evidence, 'run005-runner.safe.json'), JSON.stringify({ receipts, exitCode }, null, 2), { mode: 0o600 });
}
if (exitCode !== 0) process.exitCode = 1;
