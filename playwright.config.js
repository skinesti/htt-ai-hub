import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  timeout: 60000,
  reporter: [['list']],
  outputDir: '.local/test-results',
  use: { ...devices['Desktop Chrome'], headless: true }
});
