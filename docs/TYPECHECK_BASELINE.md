# Typecheck Baseline

`npm run check` uses `scripts/svelte-check-baseline.mjs` so the repository's
pre-existing TypeScript/Svelte diagnostics do not hide new regressions.

- `npm run check` — fails only when a diagnostic is not in the recorded baseline.
- `npm run check:strict` — prints the complete legacy report.
- `npm run check:baseline` — regenerate the baseline after a deliberate cleanup.

The baseline is a ratchet: fix legacy diagnostics and regenerate it downward;
do not add new diagnostics to the baseline to make a failing change pass.

Current baseline: 5782 legacy diagnostics (pre-existing repo debt).
