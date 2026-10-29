import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const modal = readFileSync(join(here, 'SettingsModal.svelte'), 'utf8');
const connections = readFileSync(join(here, 'Settings/Connections.svelte'), 'utf8');

describe('unified provider settings navigation', () => {
	it('has one connections tab, preserving search for both older labels', () => {
		expect(modal.match(/id: 'connections',/g)).toHaveLength(1);
		expect(modal).not.toContain("id: 'admin:connections',");
		expect(modal).toContain("searchPrefixes: ['settings.personal.connections.', 'settings.admin.connections.']");
	});

	it('redirects admin deep links into the single entry and selects the admin list', () => {
		expect(modal).toContain("show.tab === 'admin:connections' ? 'connections' : show.tab");
		expect(modal).toContain("show === 'admin:connections' ? 'connections' : show");
		expect(modal).toContain("{ connectionView: 'all' }");
		expect(modal).toContain("$user?.role === 'admin' ? 'all' : 'mine'");
	});

	it('only offers the all connections view to admins and mounts one provider list', () => {
		expect(connections).toContain("$user?.role === 'admin' ? [['all', 'All connections']] : []");
		expect(connections).toContain('<ProviderServices mode={$user?.role === \'admin\' ? \'admin\' : \'personal\'} view={connectionView} />');
		expect(connections).toContain('<AdminConnections />');
	});
});
