import { defineConfig } from '@playwright/test';
import base from './funding.config.ts';
export default defineConfig({ ...base, testMatch: 'workspace-free-concurrency-sandbox.test.ts' });
