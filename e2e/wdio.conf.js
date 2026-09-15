// WebdriverIO smoke test against the debug build, via tauri-driver.
// Linux (webkit2gtk-driver) and Windows (msedgedriver) only; Tauri has no
// WebDriver support on macOS.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const binary = path.join(
  root,
  "target",
  "debug",
  process.platform === "win32" ? "misket.exe" : "misket",
);
const tmp = mkdtempSync(path.join(os.tmpdir(), "misket-e2e-"));

// Test-only startup hooks (see src-tauri/src/commands/e2e.rs). The app inherits
// tauri-driver's environment, so they are set on the driver process.
const e2eEnv = {
  MISKET_E2E_PROJECT: path.join(tmp, "smoke.misket"),
  MISKET_E2E_NAME: "Smoke study",
  MISKET_E2E_IMPORT: path.join(root, "fixtures", "sample.txt"),
};

let tauriDriver;

export const config = {
  runner: "local",
  specs: ["./specs/**/*.spec.js"],
  maxInstances: 1,
  hostname: "127.0.0.1",
  port: 4444,
  capabilities: [
    {
      maxInstances: 1,
      "tauri:options": {
        application: binary,
      },
    },
  ],
  reporters: ["spec"],
  framework: "mocha",
  mochaOpts: { ui: "bdd", timeout: 60000 },
  logLevel: "warn",

  // Build the app once, then start tauri-driver for the session.
  onPrepare: () => {
    if (process.env.MISKET_E2E_SKIP_BUILD) return;
    const r = spawnSync("pnpm", ["tauri", "build", "--debug", "--no-bundle", "--ci"], {
      cwd: root,
      stdio: "inherit",
    });
    if (r.status !== 0) throw new Error("tauri build failed");
  },
  beforeSession: () => {
    tauriDriver = spawn("tauri-driver", [], {
      stdio: [null, process.stdout, process.stderr],
      env: { ...process.env, ...e2eEnv },
    });
  },
  afterSession: () => {
    tauriDriver?.kill();
  },
};
