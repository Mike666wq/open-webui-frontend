// Consume the already verified bundle from this workflow, never rebuild it for Android.
import { createRunnerFrontendLock } from '../apps/client/scripts/create-runner-frontend-lock.mjs';
import { validateFrontendLock } from '../apps/client/scripts/prepare-bundled-frontend.mjs';
const lock = await createRunnerFrontendLock({
  frontendRoot: process.env.FRONTEND_BUNDLE_ROOT,
  sourceCommit: process.env.FRONTEND_SOURCE_SHA,
  output: 'apps/client/frontend.lock.json',
});
validateFrontendLock(lock);
