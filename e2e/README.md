# End-to-end smoke test

Runs the debug build through [tauri-driver](https://tauri.app/develop/tests/webdriver/)
and WebdriverIO. Linux and Windows only (Tauri has no WebDriver on macOS).

```sh
# Linux prerequisites
sudo apt-get install webkit2gtk-driver
cargo install tauri-driver --locked

cd e2e && pnpm install
pnpm test                       # builds the debug binary first
MISKET_E2E_SKIP_BUILD=1 pnpm test   # reuse target/debug/misket
```

The app is launched with `MISKET_E2E_PROJECT` and `MISKET_E2E_IMPORT` set, so
it opens a fresh project and imports `fixtures/sample.txt` without any native
dialog. `MISKET_E2E_IMPORT` takes a comma-separated list, so adding
`fixtures/sample.png` exercises the image viewer the same way.

`MISKET_E2E_UPDATE_JSON` points the update check at a local `latest.json`
(e.g. `http://127.0.0.1:8991/latest.json`, served with `python3 -m
http.server` from a scratch directory) instead of the real GitHub endpoint,
so the "update available" banner can be exercised and screenshotted without
a signed release — see `src-tauri/src/commands/updater.rs`'s
`e2e_check_update` and `src/state/updates.ts`. Installing genuinely tries to
download and verify the fake release, which is expected to fail signature
verification unless you also sign it with a real key.
