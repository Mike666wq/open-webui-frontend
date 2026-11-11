# UI audit — measuring the interface instead of guessing

`scripts/ui-audit.mjs` measures what a screenshot cannot be trusted to show:
text contrast, font size, mobile hit targets and horizontal overflow, across
routes × themes × viewports.

```bash
node scripts/ui-audit.mjs \
  --origin http://127.0.0.1:8080 \
  --email admin@example.test --password '…' \
  --themes light,dark --viewports 1440x900,390x844
```

Exit code `1` means at least one finding; `artifacts/ui-audit/report.json` holds
the full measurements.

## Why it resolves colours through a canvas

The appearance engine writes `oklch()` values, and several surfaces are
translucent glass. Reading `getComputedStyle().color` and treating it as RGB
produces nonsense — an early version of this script reported ~1.31:1 for
essentially every element. The audit therefore paints each colour onto a 1×1
canvas (which normalises `oklch`, `rgba`, `color-mix` and friends to sRGB) and
composites the translucent ancestor backgrounds before computing the ratio.

## What each check means

| Check | Threshold | Notes |
|---|---|---|
| Text contrast | 4.5:1 | WCAG AA for normal text |
| Font size | ≥ 11px | below this is hard to read at a glance |
| Hit target (mobile) | ≥ 32px | `button[aria-label]` only |
| Horizontal overflow | none | `scrollWidth > innerWidth + 2` |

Form fields are exempt from the hit-target rule: they are wide, and their
padding is not what makes them tappable. Icon buttons are the concern.

## When the production build is unavailable

`npm run build` must pass before a release, but it can stall at vite's chunk
stage on a memory-constrained machine (measured: on an 8 GB host with swap
exhausted, client bundling ran 30+ minutes without writing output while the
compile step had already printed `✓ N modules transformed`). That is an
environment failure, not a code failure, and retrying it does not help.

Verify through the dev server instead — it compiles on demand and needs far less
memory:

```bash
# 1) local backend (the dev server proxies /api to it)
cd <backend>/backend && uvicorn open_webui.main:app --host 127.0.0.1 --port 8093

# 2) dev server pointed at that backend
cd <frontend> && WEBUI_BACKEND_URL=http://127.0.0.1:8093 npx vite dev --host 127.0.0.1 --port 5199

# 3) measure against the dev server
node scripts/ui-audit.mjs --origin http://127.0.0.1:5199 --email <admin> --password <pw>
```

Two pitfalls:

- Dev compiles each route on first load, so allow 20–40 s per navigation.
- With a Chinese interface, locate elements by their **Chinese** label
  (`选择要预览的文件`), not by the English i18n key.

## 耗时与已知限制

全量跑（13 路由 × 2 主题 × 2 视口 = 52 组）在开发机上超过一小时，**不要**把它当成
提交前的快速门禁。实测每组约一分钟，时间几乎都花在每个页面的
`Runtime.evaluate` 测量上：脚本会遍历 `body *` 并对每个文本节点做 canvas 取色
与祖先背景合成。

务实的用法：

- 提交前只跑**改动涉及的视口**，例如 `--viewports 390x844 --themes light,dark`。
- 需要逐项核对时，用一次性脚本对目标元素取色（比全量扫描快两个数量级），
  本仓库的 P-008 验收就是这么做的。
- 脚本已给 `Page.navigate`（30s）与测量（60s）加了单路由超时，超时记为一条
  发现而不是拖死整轮；但慢本身仍然是测量逻辑的固有成本。
