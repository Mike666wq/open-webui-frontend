# AGENTS.md — Open WebUI Frontend

Independent frontend source for the Android Open WebUI Client. The initial source was imported from
the **complete official Open WebUI v0.12.2 UI** at
`open-webui/open-webui@6a18585ff4c2e5f6805f682222cfbc46dc669ef8`.

This repo has its own Git history from that imported baseline and **does not track or synchronize an
upstream remote**. The baseline version and commit stay recorded in `frontend.upstream.json`.

This repo also hosts the Android client at `apps/client/` (Tauri 2 / Rust / Kotlin) and publishes
both the web bundle and the signed APK. See `docs/TWO_REPOSITORY_PIPELINE.md`.

## Setup commands

- Install deps: `npm ci` (Node **22**, per `.nvmrc`; `CYPRESS_INSTALL_BINARY=0` to skip Cypress)
- Start dev:    `npm run dev`          (Vite, proxies to the backend origin in `.env.local`)
- Build:        `npm run build`        (SvelteKit production build → `build/`)
- Bundle:       `npm run frontend:bundle` (→ `dist/` with `frontend-manifest.json` + `SHA256SUMS`)
- Unit test:    `npm run frontend:test` (packaging) + `npm run test:frontend` (Vitest, excludes `apps/**`)
- Typecheck:    `npm run check`        (`svelte-check`)
- Lint:          `npm run lint`         (eslint + svelte-check + pylint on the embedded backend)
- Mobile smoke: `npm run test:mobile:browser` (real Chromium, needs `CHROME_BIN`)
- Client:       `cd apps/client && npm ci && npm test` (Tauri client, separate lockfile)

## Project layout

- `src/routes/` — SvelteKit routes (`(app)/`, `auth/`, `mist-preview/`, `watch/`, `s/`)
- `src/lib/appearance/` — Mist Glass token engine, presets, wallpaper library (IndexedDB)
- `src/lib/components/mist/` — Mist Glass shell components (AppBackdrop, AppTopbar, GlassSurface…)
- `src/lib/components/appearance/` — appearance editor, crop editor, live preview
- `src/lib/components/chat/` — chat surface, `ConversationNavigator.svelte`, settings modal
- `src/lib/apis/` — API clients; `providers/`, `recordings/`, `notifications/` are fork-specific
- `src/lib/messaging/` — native notify bridge, presence alerts, member directory
- `src/lib/i18n/locales/` — 64 upstream locales
- `apps/client/` — Tauri 2 + Rust + Kotlin Android client (see `apps/client/AGENTS.md`)
- `scripts/` — bundle/pipeline helpers, browser fixtures, `pipeline-changes.py`
- `docs/` — project documentation (plans, provider and recording contracts)

## Code style

- TypeScript strict mode (`tsconfig.json`); Svelte 5 with runes
- Prettier: tabs, single quotes, print width 100, no trailing comma (`.prettierrc`)
- ESLint via `.eslintrc.cjs`; run `npm run lint:frontend`
- New frontend code lives in `src/lib/<domain>/`; upstream components are extended, not forked,
  unless the change is genuinely incompatible with the upstream API.

## Testing instructions

- Vitest: `npm run test:frontend` — add a `*.test.ts` beside the module under test
- Packaging: `npm run frontend:test`
- Mobile layout: `npm run test:mobile:browser` (real Chromium; requires CJK fonts for screenshots)
- CI runs `frontend.yml`: checks → real-Chromium mobile smoke → immutable bundle release

## Fork-specific invariants

- Upstream `CHANGELOG.md`, `LICENSE`, `LICENSE_HISTORY`, `LICENSE_NOTICE` are **verbatim upstream**.
  Fork changes go in `docs/` and commit messages.
- The appearance system is an **additive layer**: CSS custom properties and `data-owui-*` attributes
  on `<html>`, not rewritten upstream components.
- i18n is **not** enforced by CI. New user-facing strings currently use inline bilingual helpers
  (`copy('中文','English')`); if you add real `$i18n.t()` keys, add them to
  `src/lib/i18n/locales/zh-CN/translation.json` as well.
- `frontend-manifest.json` must record the exact `sourceCommit`; CI fails the build on a mismatch.

## PR & commit conventions

- Branch from `main` as `codex/<feature-slug>`; never push to `main` directly
- Conventional commits (`feat:` / `fix:` / `docs:` / `test:` / `refactor:`)
- `frontend.yml` is the only active workflow entry point; `android.yml` and `client-quality.yml`
  are reusable internal workflows.

## Local environment constraints

- **No Rust toolchain is installed locally** (`cargo`/`rustc` absent), so `apps/client` Rust and
  Kotlin changes cannot be compiled or unit-tested on this machine — they are verified only by
  GitHub Actions. Say so explicitly instead of implying local verification.
- Local Node is **26**; the project targets **22** (`.nvmrc`). Use `nvm use` before builds when you
  can, but **the Node major version is not what actually breaks `npm run build`** — see the next
  bullet before chasing a version downgrade.
- **`npm run build` aborts with SIGABRT (exit 134) unless the V8 heap is raised.** The failure is an
  out-of-memory abort, not a toolchain bug:

  ```
  FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
  ```

  Node **24 and 26 both** die at the default ~2 GB heap. `--max-old-space-size` is the thing that
  actually matters:

  ```
  NODE_OPTIONS=--max-old-space-size=8192 npm run build
  ```

  An earlier belief that "Node 26 is broken, downgrade to 22" was a red herring — the same abort
  reproduces on Node 24. Do not report a version problem; report the heap limit.
- **`npm run build` runs `pyodide:fetch` first**, which has two traps:
  1. It needs a populated `static/pyodide/*.whl` cache. Without one it fails with
     `Error: No wheel bundled for: pandas`. Copying the wheels from another checkout that has
     already fetched them is enough; they are git-ignored.
  2. It **rewrites the tracked `static/pyodide/pyodide-lock.json`** as a side effect (it can bump
     wheel versions). Always restore it after a build so it does not land in the diff:

     ```
     git checkout -- static/pyodide/pyodide-lock.json
     ```
- **`npm run test:mobile:browser` does not start its own fixture server.** It polls
  `http://127.0.0.1:8765/__fixture_provenance` and fails with `TypeError: fetch failed` if nothing
  is listening. Reproduce what CI does first:

  ```
  npm run frontend:bundle                      # produces dist/frontend-manifest.json
  cp dist/frontend-manifest.json build/frontend-manifest.json
  node scripts/fixtures/mobile-layout-api-server.mjs build &
  CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run test:mobile:browser
  ```

  Chromium needs `--no-sandbox` in restricted sandboxes; the smoke script already passes it.
