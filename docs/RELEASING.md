# Releasing Misket

How `.github/workflows/release.yml` builds and publishes a release, how the
in-app updater is signed, and how to add macOS/Windows code signing when
certificates are available. None of the signing steps are set up yet — the
workflow runs unsigned until a maintainer adds the secrets below — but
everything is wired so adding them is the only step left.

## 1. Generate the updater signing keypair (one time)

The Tauri updater checks a `latest.json` manifest and verifies a signature
before installing anything, so every release needs to be signed with a
keypair only the maintainer holds.

```sh
pnpm tauri signer generate -w ~/.tauri/misket.key
```

This prompts for a password (used to encrypt the private key file; don't
lose it) and writes two files:

- `~/.tauri/misket.key` — the **private** key. Never commit this.
- `~/.tauri/misket.key.pub` — the **public** key, a single base64 line.

It also prints the exact environment variable names the CLI uses to sign a
build:

- `TAURI_SIGNING_PRIVATE_KEY` — the private key, as a **string**: the whole
  contents of `~/.tauri/misket.key` (`cat ~/.tauri/misket.key`), not a path.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the password chosen above.

### Where the two halves go

1. **Public key** → `src-tauri/tauri.conf.json`, replacing the placeholder:

   ```json
   "plugins": {
     "updater": {
       "endpoints": ["https://github.com/izgebayyurt/misket/releases/latest/download/latest.json"],
       "pubkey": "<contents of misket.key.pub>"
     }
   }
   ```

   `src-tauri/src/commands/updater.rs` has a matching `PUBKEY_PLACEHOLDER`
   constant and a test (`placeholder_matches_the_shipped_tauri_conf`) that
   fails on purpose once the config no longer says the placeholder —
   `cargo test` will remind you to update the constant (or delete that test)
   in the same commit as the real key. Until both are updated, the app
   treats the updater as unconfigured and never calls the real endpoint (see
   `get_updater_status` and `src/state/updates.ts`), so a fresh clone never
   ships a build that errors on start.

2. **Private key + password** → GitHub repo secrets (Settings → Secrets and
   variables → Actions → New repository secret):
   - `TAURI_SIGNING_PRIVATE_KEY`: paste the whole contents of
     `~/.tauri/misket.key`.
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the password.

Keep `~/.tauri/misket.key` itself somewhere durable outside the repo (a
password manager or an encrypted backup) — if it's lost, past releases can
still be verified by users already running Misket, but you can never publish
another update signed with the same key, and everyone would need to
reinstall from a fresh download instead of updating in place.

Once both secrets exist, `.github/workflows/release.yml` passes them to
`tauri-apps/tauri-action`, which signs every bundle and writes `latest.json`
(`includeUpdaterJson: true`) alongside the release assets. `latest.json` is
what `plugins.updater.endpoints` in `tauri.conf.json` points at.

## 2. macOS code signing and notarisation (optional, has a cost)

Requires an [Apple Developer Program](https://developer.apple.com/programs/)
membership (paid, ~$99/year).

1. In [developer.apple.com](https://developer.apple.com/account/resources/certificates/list),
   create a **Developer ID Application** certificate (not "Apple
   Distribution" — that's for the App Store). Download it and double-click
   to add it to Keychain Access.
2. Export it as a `.p12`: in Keychain Access, find the certificate under
   "My Certificates", right-click → Export, choose "Personal Information
   Exchange (.p12)", and set an export password.
3. Base64-encode it and add as a secret:
   ```sh
   base64 -i DeveloperIDApplication.p12 | pbcopy
   ```
   Add as `APPLE_CERTIFICATE`. Add the export password as
   `APPLE_CERTIFICATE_PASSWORD`.
4. Find your signing identity's exact name:
   ```sh
   security find-identity -v -p codesigning
   ```
   It looks like `Developer ID Application: Your Name (TEAMID1234)`. Add the
   whole string as `APPLE_SIGNING_IDENTITY`.
5. Notarisation needs an app-specific password, not your Apple ID password:
   sign in at [appleid.apple.com](https://appleid.apple.com) → Sign-In and
   Security → App-Specific Passwords → generate one. Add your Apple ID email
   as `APPLE_ID`, the app-specific password as `APPLE_PASSWORD`, and your
   [Team ID](https://developer.apple.com/account#MembershipDetailsCard)
   (10 characters, next to your name in the Membership section) as
   `APPLE_TEAM_ID`.

`tauri-apps/tauri-action` only attempts to sign and notarise when
`APPLE_CERTIFICATE` is present (see `release.yml`), so the macOS job keeps
succeeding — unsigned — until all five secrets exist. The workflow also
posts a warning to the job summary on an unsigned macOS build, as a nudge.

## 3. Windows code signing (optional, has a cost either way)

Windows SmartScreen reputation is what actually matters to users, and it
builds up over time and download volume, not just from having a
certificate — a brand-new certificate still shows warnings for a while.
Two options, in the order tauri-action supports them:

**Option A — a code-signing certificate as a `.pfx`.** Buy one from a CA
(Sectigo, DigiCert, SSL.com, ...); a standard OV certificate runs roughly
$70–400/year depending on the vendor and term. Export or convert it to a
password-protected `.pfx`, then:

```sh
base64 -w0 certificate.pfx > cert.b64   # macOS: base64 -i certificate.pfx | tr -d '\n'
```

Add the contents of `cert.b64` as the `WINDOWS_CERTIFICATE` secret and the
`.pfx` password as `WINDOWS_CERTIFICATE_PASSWORD`. `release.yml` already
passes both through; tauri-action signs with them automatically when
present, no `tauri.conf.json` change needed.

**Option B — Azure Trusted Signing.** Microsoft's newer, cheaper
alternative (roughly $10/month at time of writing) that also starts with
better SmartScreen reputation than a fresh OV certificate, at the cost of
more setup: an Azure account, a Trusted Signing account and certificate
profile, and signing from an Azure identity instead of a local file. This
needs a custom sign command instead of the two secrets above. Once you have
an Azure Trusted Signing profile, add this to `bundle.windows` in
`tauri-conf.json` (both keys, uncommented):

```json
"windows": {
  "signCommand": "trusted-signing-cli -e https://<endpoint> -a <account> -c <certificate-profile> %1"
}
```

and install [`trusted-signing-cli`](https://crates.io/crates/trusted-signing-cli)
in the workflow before the `tauri-action` step, authenticated via
`azure/login` with a service principal stored in secrets. See
[Tauri's Windows signing guide](https://v2.tauri.app/distribute/sign/windows/)
for the current step-by-step, since Azure's own setup flow changes more
often than this file does. Do not set up both options — pick one.

Neither `certificateThumbprint` (a locally-installed certificate, e.g. an
EV certificate on a hardware token) nor `signCommand` is set in
`tauri.conf.json` yet; add whichever option you choose there.

## 4. Cutting a release

1. Bump the version in `src-tauri/tauri.conf.json` (`version`) and
   `src-tauri/Cargo.toml` / `Cargo.toml` (`workspace.package.version`) if
   they're meant to move together, and `package.json`.
2. Commit, then tag and push:
   ```sh
   git tag v0.2.0
   git push origin v0.2.0
   ```
3. This triggers `.github/workflows/release.yml`, which builds macOS
   (Apple Silicon + Intel), Windows and Linux, signs the updater artifacts
   (and the app itself, once the secrets above exist), and opens a **draft**
   GitHub release with all of them attached, including `latest.json`.
4. Check the draft: download and sanity-check a build, review the
   auto-filled release notes, add your own if you want more than the
   boilerplate.
5. Publish the draft. `latest.json` is now live at
   `https://github.com/izgebayyurt/misket/releases/latest/download/latest.json`
   — the exact URL `plugins.updater.endpoints` in `tauri.conf.json` points
   at — so every running copy of Misket that checks for updates (on launch,
   or Settings → "Check for updates…") sees it within one check.

## 5. What users see on an unsigned build

Until the secrets above exist, published builds are unsigned. This is
expected, not broken:

- **macOS**: Gatekeeper refuses to open the app and may call it "damaged"
  or "from an unidentified developer". Right-click (or Control-click) the
  app in Finder and choose **Open**, confirm in the dialog, or go to
  **System Settings → Privacy & Security** and click **Open Anyway**. Only
  needed once per release.
- **Windows**: SmartScreen shows "Windows protected your PC". Click
  **More info**, then **Run anyway**. Only appears on the first run of a
  new release.

`README.md`'s Install section and `site/docs/install.html` both explain this
to users; update them if the wording here changes.
