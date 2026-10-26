# AGENTS.md — Open WebUI Client (apps/client)

Tauri 2 native shell (Rust) + Android plugin (Kotlin) that wraps a connected Open WebUI backend.
Imported into this repo from `Mike666wq/open-webui-client@621b666b674da5118ae2b1e28e19efce0eef6ba4`
(v0.2.32). The legacy repo keeps the older history and releases ≤ v0.2.32; **all new client work
lands here**.

The APK ships the web frontend locally and talks to a **remote** backend. The APK contains no
server-side code.

## Setup commands

- Install deps: `npm ci` (Node 22) — then `rustup` toolchain `1.94.0` per `rust-toolchain.toml`
- Dev:          `npm run dev` (Vite at `127.0.0.1:1420`; `npm run tauri dev` for the shell)
- Build:        `npm run build` (webview assets → `dist/`); `npm run tauri build` for bundles
- Unit test:    `npm test` (`node --test scripts/*.test.mjs scripts/*.test.js src/app.test.js`)
- Version check: `npm run version:check` (`node scripts/manage-version.mjs check`)
- Frontend pin: `npm run frontend:prepare` (fetches + verifies the locked frontend bundle)

`prebuild` runs `generate-client-config.mjs` → `prepare-assets.mjs` →
`prepare-bundled-frontend.mjs --if-android`. The bundled frontend is a **generated** directory and
must never be hand-edited or committed.

## Project layout

- `src/` — the local connection-settings webview (Vite, plain JS): `app.js`, `trust.js`,
  `connection-state.js`, `android-strings.js`
- `src-tauri/src/connection.rs` — connection state machine, capability injection, persistence
- `src-tauri/src/save.rs` — download/save bridge (chunked, capped, session-scoped)
- `src-tauri/src/navigation.rs` — navigation allow-list + init scripts
- `src-tauri/src/android_client.rs` — the native action queue (no page event may enter it)
- `src-tauri/plugins/connection-controls/` — Tauri plugin; Android side is Kotlin under
  `android/src/main/java/local/openwebui/connectioncontrols/`
- `scripts/` — Node tests, Python Android diagnostics/emulator harnesses
- `docs/` — acceptance checklist, CI runbook, project status

## Security and correctness invariants

- **Address validation**: HTTP/HTTPS only; no path, query, fragment or credentials; reject
  `tauri.localhost`; reject backslashes. Implemented twice on purpose — `src/trust.js` and
  `connection.rs::validate_service_url` — keep them in sync.
- **Per-connection capabilities**: every connection attempt injects a `CapabilityBuilder` scoped to
  exactly that origin (`remote("{origin}/*")`) and grants only `connection-ready`, `open-external`
  and the four save commands. Never widen this.
- **Session binding**: native commands require `generation` + `session_token` matching the live
  session (`require_current_session`). Re-check after every async user interaction.
- **Navigation**: local entry → allowed; current service origin → allowed; other http(s) → open in
  the system browser; everything else → denied.
- **Downloads**: explicit downloads go through the save bridge. Ordinary images, media previews and
  same-origin links stay in the WebView. On Android, use `ACTION_CREATE_DOCUMENT`; the file URI and
  path must never reach page script.
- **Native-only controls**: remote pages must not be able to invoke native commands. The plugin
  denies page-originated calls; the action queue is fed only by app-owned code.
- **Bundled frontend routing** (`BundledFrontendPolicy.kt`): API / ws / socket.io / download paths
  stay real network requests; local assets are SHA-256 verified; encoded traversal (`%2f`, `%2e`,
  `%5c`, `%00`) is rejected; a missing asset must never fall back to the network, so an old runtime
  cannot mix with new server chunks.

## Tests

- Rust and Kotlin unit tests live in the Android plugin's own Gradle test source set and run in the
  Android CI job; the Node suite covers the JS/webview layer.
- `scripts/` holds the Node test files and the Python Android/emulator diagnostic harnesses.
- A green CI run is **not** device acceptance. HyperOS startup, real SAF providers, real models and
  multi-device behaviour still require manual verification — report them as unverified.

## PR & commit conventions

- Branch from `main` as `codex/<feature-slug>`; never push to `main` directly
- Conventional commits (`feat:` / `fix:` / `docs:` / `test:`)
- Version bumps touch exactly five version files plus `frontend.lock.json`, never the web version.
  `npm run version:check` must pass.
- The Android signing identity is carried over from the legacy repo — **never regenerate it**.
