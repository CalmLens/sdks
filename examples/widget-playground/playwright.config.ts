import { defineConfig, devices } from "@playwright/test";

const port = 6420;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://localhost:${port}`, trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: `bun run dev --port ${port} --strictPort`,
    url: `http://localhost:${port}/api/config`,
    reuseExistingServer: false,
    // Mock mode: no credentials reach the dev server, whatever the shell has set.
    env: {
      CALMLENS_API_KEY: "",
      CALMLENS_PROJECT_ID: "",
      CALMLENS_UPLOAD_PRESET_ID: "",
      CALMLENS_API_URL: "",
      CALMLENS_CDN_URL: "",
    },
  },
});
