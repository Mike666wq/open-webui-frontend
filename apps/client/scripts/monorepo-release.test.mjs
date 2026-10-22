import test from 'node:test';
import assert from 'node:assert/strict';
import { createGitHubAdapter } from './release-orchestrator.mjs';

test('release preparation writes client-prefixed files and includes the exact frontend lock', async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({url, body});
    let result;
    if (url.endsWith('/git/commits/' + 'a'.repeat(40))) result = {tree: {sha: 'base-tree'}};
    else if (url.includes('/git/trees/base-tree')) result = {sha: 'base-tree', tree: [], truncated: false};
    else if (url.endsWith('/git/blobs')) result = {sha: 'blob'};
    else if (url.endsWith('/git/trees')) result = {sha: 'new-tree'};
    else if (url.endsWith('/git/commits')) result = {sha: 'b'.repeat(40)};
    else if (url.endsWith('/git/refs/heads/main')) result = {};
    else throw new Error('Unexpected API route');
    return {ok: true, status: 200, json: async () => result};
  };
  try {
    const adapter = createGitHubAdapter({GITHUB_REPOSITORY: 'owner/frontend', GITHUB_TOKEN: 'test-placeholder', CLIENT_REPOSITORY_PATH: 'apps/client'});
    await adapter.commitReleaseBump({expectedBaseSha: 'a'.repeat(40), runId: '123', version: '0.2.33',
      marker: 'openwebui-release-run:123', versionCode: 200001,
      versionFiles: {'package.json': '{}', 'frontend.lock.json': '{"sourceCommit":"verified"}'}});
    const tree = requests.find(item => item.url.endsWith('/git/trees')).body;
    assert.deepEqual(tree.tree.map(item => item.path), ['apps/client/package.json', 'apps/client/frontend.lock.json']);
    assert.ok(!tree.tree.some(item => item.path === 'package.json'));
    const update = requests.find(item => item.url.endsWith('/git/refs/heads/main')).body;
    assert.equal(update.force, false);
    const commit = requests.find(item => item.url.endsWith('/git/commits')).body;
    assert.match(commit.message, /openwebui-android-version-code:200001/);
  } finally { globalThis.fetch = original; }
});
