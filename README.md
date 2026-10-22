> 两仓库共同进度见 [当前进度](docs/PROJECT_STATUS.md)，操作方式见 [GitHub 构建与人工验收](docs/CLOUD_DEVELOPMENT.md)。Codespaces 当前暂停使用，尚未验收可用。

# Open WebUI Frontend

Independent frontend source for the Android Open WebUI Client. The initial
source was imported from the **complete official Open WebUI v0.12.2 UI** at
`open-webui/open-webui@6a18585ff4c2e5f6805f682222cfbc46dc669ef8`.
This repository has its own Git history from that imported baseline and does
not track or synchronize an upstream remote. The baseline version and commit
remain recorded in `frontend.upstream.json` for compatibility checks.
Open WebUI branding, `LICENSE`, `LICENSE_HISTORY` and third-party notices are
retained.

This repository maintains the DIY Svelte UI and publishes verified static bundles.
Both the backend image and Android APK consume that same pinned bundle. Backend
accounts, models and conversations remain managed by the backend repository.

Daily development can stay in a local editor with Git; GitHub Actions installs
dependencies, tests and builds. Local hot reload below is optional when resources
permit. Manual acceptance uses an isolated test service and physical devices.
Codespaces is paused after real initialization failures and is not a release gate.

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

This repository owns both the web frontend and the Android client at `apps/client/`.
Backend source and container publishing remain in [open-webui-backend](https://github.com/Mike666wq/open-webui-backend).
See [two-repository migration and signing](docs/TWO_REPOSITORY_PIPELINE.md).

The `frontend` workflow selects jobs from changed paths. Documentation and Codespaces changes do not publish products.
Web changes run package/unit/browser checks, build once and publish immutable `frontend-<SHA12>` assets.
The Android reusable workflow runs after the web release, reuses the exact same verified bundle, retains the
original application/signing identity, and publishes the signed ARM64 APK here. Native-only changes reuse
the client's checked-in frontend lock without rebuilding the web UI. APK and backend image builds can run in parallel.
Client and web npm packages retain independent versions and lockfiles.

Backend polling resolves the latest **published frontend product in main history**, ignoring APK releases and
subsequent documentation/native-only commits. Its own lock pins source and hashes; image smoke/Compose checks gate promotion.
Polling is scheduled approximately every 15 minutes; GitHub may delay it. Manual backend sync remains available.
Public assets are immutable; failed checks cannot publish an APK or promote a backend image.

## Upstream and license

This is an independently maintained derivative, not an official Open WebUI
release. The imported official UI is the compatibility baseline; this fork now includes
DIY appearance/wallpaper/navigation and resource-management UI changes. Source
implementation and automated checks do not imply every page has passed manual acceptance. Frontend and client source are maintained here; no backend runtime is launched by
the frontend workflow.

Read [LICENSE](LICENSE), [LICENSE_HISTORY](LICENSE_HISTORY) and the applicable
third-party notices before redistribution. Open WebUI branding conditions
continue to apply. The original project overview is preserved in
[docs/UPSTREAM_README.md](docs/UPSTREAM_README.md).
