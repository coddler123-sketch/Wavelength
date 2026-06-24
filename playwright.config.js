const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './scripts/e2e',
  timeout: 30_000,
  retries: 0,
  reporter: 'line',
  use: {
    headless: false,
  },
});
