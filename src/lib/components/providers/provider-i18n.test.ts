import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = join(HERE, '../../i18n/locales');
const LOCALES = ['zh-CN', 'en-US'];

const COMPONENT_FILES = [
	...readdirSync(HERE)
		.filter((name) => name.endsWith('.svelte'))
		.map((name) => join(HERE, name)),
	// The legacy migration panel lives next to the components but belongs to the same UI.
	join(HERE, '../ProviderLegacyMigration.svelte')
];

function translation(locale: string): Record<string, string> {
	return JSON.parse(readFileSync(join(LOCALES_DIR, locale, 'translation.json'), 'utf8'));
}

/** Every `$i18n.t('...')` literal used by the provider components. */
function usedKeys(): string[] {
	const keys = new Set<string>();
	for (const file of COMPONENT_FILES) {
		const source = readFileSync(file, 'utf8');
		const pattern = /\$\s*i18n\.t\(\s*'([^']+)'/g;
		let match: RegExpExecArray | null;
		while ((match = pattern.exec(source)) !== null) {
			keys.add(match[1]);
		}
	}
	return [...keys].sort();
}

describe('provider component translations', () => {
	it('uses at least one translatable string', () => {
		expect(usedKeys().length).toBeGreaterThan(0);
	});

	it.each(LOCALES)('has every used key in %s', (locale) => {
		const dictionary = translation(locale);
		const missing = usedKeys().filter((key) => !(key in dictionary));
		expect(missing).toEqual([]);
	});
});
