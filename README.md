> 云端开发和前端 → 后端镜像 / APK 串联构建，见 [云端开发说明](docs/CLOUD_DEVELOPMENT.md)。

# Open WebUI Frontend

Independent frontend source for the Android Open WebUI Client. The initial
source was imported from the **complete official Open WebUI v0.12.2 UI** at
`open-webui/open-webui@6a18585ff4c2e5f6805f682222cfbc46dc669ef8`.
This repository has its own Git history from that imported baseline and does
not track or synchronize an upstream remote. The baseline version and commit
remain recorded in `frontend.upstream.json` for compatibility checks.
Open WebUI branding, `LICENSE`, `LICENSE_HISTORY` and third-party notices are
retained.

Develop the real Svelte UI in a local browser with hot updates, then package the
same static frontend for Android. Your existing Open WebUI backend continues to
manage accounts, models and conversations. No new website deployment, backend
image, Docker build or APK job is included here.

## Local development

Use Node **22** (`.nvmrc`) and the existing npm lockfile:

```sh
nvm install
nvm use
CYPRESS_INSTALL_BINARY=0 npm ci
cp .env.example .env.local
```

In the ignored `.env.local`, set only the backend origin needed for development:

```dotenv
WEBUI_BACKEND_URL=http://localhost:8080
```

Replace that example with your reachable existing backend, then start:

```sh
npm run dev:local
```

Open `http://127.0.0.1:5173`. Changes to `src/` update through Vite HMR; there is
no Android packaging step while adjusting the UI. This baseline targets backend
v0.12.2. Use an existing account and sign in on this local browser origin.
Localhost has its own browser session; do not copy tokens or login credentials
into source files.

Vite forwards `/api`, `/ws`, `/openai`, `/ollama`, `/oauth` and `/cache` to
`WEBUI_BACKEND_URL`, including WebSocket upgrades. Manifest and OpenSearch requests
also reach the backend. Bundled frontend assets remain local. The first start
prepares the official Pyodide assets and can take longer than subsequent starts.
HTTPS-only cookies, OAuth callbacks or a forward-auth proxy can need additional
development setup; these are not silently bypassed.

## Validation and the Android bundle

```sh
npm run frontend:test
npm run test:frontend -- --run
npm run build
npm run frontend:bundle
```

`frontend:bundle` requires Python 3 for standard-library ZIP support. It writes:

- `dist/open-webui-frontend.zip`
- `dist/frontend-manifest.json`
- `dist/SHA256SUMS`

The ZIP root is the official `build/` content plus **`frontend-manifest.json`**.
The existing official `/manifest.json` remains the PWA manifest.

The versioned packaging metadata contains:

```json
{
	"schema": 1,
	"upstreamVersion": "0.12.2",
	"upstreamCommit": "6a18585ff4c2e5f6805f682222cfbc46dc669ef8",
	"sourceRepository": "Mike666wq/open-webui-frontend",
	"sourceCommit": "<full frontend Git commit>",
	"entry": "index.html",
	"pageRoutes": ["^/$", "^/c/[^/]+/?$"],
	"files": [
		{
			"path": "index.html",
			"sha256": "<SHA256 of the exact file bytes>",
			"size": 123,
			"mime": "text/html"
		}
	]
}
```

`pageRoutes` is generated from **all** actual Svelte page files, including
administration and workspace pages. It is an anchored regular-expression list
for URL pathnames, without query strings. Backend paths never become frontend SPA
fallbacks. New unsupported Svelte route syntax blocks packaging until reviewed.
`files` lists every bundled asset in sorted order and excludes the metadata
itself. Symlinks and unsafe paths are rejected. ZIP entries use stable timestamps.

The Android consumer must pin the frontend source commit, exact ZIP URL and ZIP
SHA256, then check the metadata and every extracted file. HTML and frontend
version files must not be served from stale caches; a missing local compilation
asset must not fall back to another version's server asset.

## GitHub process

Only the frontend workflow is enabled. A PR runs Node 22, npm cache, locked
dependency installation, packaging tests, the upstream frontend unit tests and
the official production frontend build. Merging to `main` builds the same
frontend bundle and automatically publishes:

```text
frontend-<first 12 characters of the main source commit>
```

Release assets are the ZIP, metadata and `SHA256SUMS`. A retry accepts an already
published matching bundle and never replaces mismatching public assets. Each
run/attempt's intermediate artifact is retained for 14 days.

Android downloads a **fixed release** during its build. PR quick checks in the
Android repository do not need to download the whole frontend. This repository
does not build or publish a backend image, deploy a site, run an Android emulator
or generate an APK.

## Upstream and license

This is an independently maintained derivative, not an official Open WebUI
release. The first delivery preserves the imported official UI while providing
a clean starting point for local UI customization. Only frontend source and the
files needed to build it are maintained here; no backend runtime is launched by
the frontend workflow.

Read [LICENSE](LICENSE), [LICENSE_HISTORY](LICENSE_HISTORY) and the applicable
third-party notices before redistribution. Open WebUI branding conditions
continue to apply. The original project overview is preserved in
[docs/UPSTREAM_README.md](docs/UPSTREAM_README.md).
