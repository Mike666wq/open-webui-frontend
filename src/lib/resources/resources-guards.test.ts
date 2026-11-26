import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const resources = readFileSync(join(here, '../components/chat/Settings/Resources.svelte'), 'utf8');

describe('resources page request guards', () => {
	it('uses the shared guard for refresh and retry, with account checks', () => {
		expect(resources).toContain("import { createRequestGuard } from '$lib/resources/refresh-guard'");
		// refresh increments the generation exactly once, at its start.
		expect(resources).toContain('const request = guard.begin($user?.id);');
		expect(resources).not.toMatch(/generation\+\+/);
		expect(resources).not.toContain('++generation');
		// retry issues without bumping the generation, then validates before writing.
		expect(resources).toContain('const request = guard.issue();');
		const retryBlock = resources.slice(
			resources.indexOf('async function retry('),
			resources.indexOf('async function clearDevice()')
		);
		expect(retryBlock).toContain('guard.isCurrent(request, disposed, get(user)?.id)');
		expect(retryBlock).toContain('if (!guard.isCurrent(request, disposed, get(user)?.id)) return;');
	});

	it('stops the old poll timer when the account changes', () => {
		expect(resources).toContain('function restartPolling() {');
		expect(resources).toContain('if (poll) clearInterval(poll);');
		expect(resources).toContain('get(user)?.id !== pollAccount');
		expect(resources).toContain('account !== pollAccount && pollAccount !== undefined');
		// Poll callback must not itself bump the generation.
		const pollBlock = resources.slice(
			resources.indexOf('function restartPolling()'),
			resources.indexOf('onMount(() => {')
		);
		expect(pollBlock).not.toContain('guard.begin(');
	});
});
