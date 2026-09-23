import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

// Cloud sessions ship a pre-installed Chromium; use it instead of downloading.
// Elsewhere the full 'chromium' channel is used (never the headless shell, which
// has no GPU backend).
const preinstalled = '/opt/pw-browsers/chromium';
const launchOptions = existsSync(preinstalled) ? { executablePath: preinstalled } : {};

export default defineConfig({
  testDir: './tests/e2e',
  // One worker: parallel WebGL contexts contend for the GPU and game time drifts.
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5188',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1280, height: 720 },
    launchOptions,
    ...(existsSync(preinstalled) ? {} : { channel: 'chromium' }),
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5188',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
