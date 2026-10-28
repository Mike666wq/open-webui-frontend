import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODAL_SOURCE = readFileSync(join(HERE, 'SettingsModal.svelte'), 'utf8');
const LOCALES_DIR = join(HERE, '../../i18n/locales');
const LOCALES = ['zh-CN', 'en-US'];

const PERSONAL_CONNECTIONS_ID = 'connections';
const ADMIN_CONNECTIONS_ID = 'admin:connections';
const PERSONAL_TITLE_KEY = 'settings.personal.connections.title';
const ADMIN_TITLE_KEY = 'settings.admin.connections.title';

function translation(locale: string): Record<string, string> {
	return JSON.parse(
		readFileSync(join(LOCALES_DIR, locale, 'translation.json'), 'utf8')
	);
}

describe('settings navigation connections dedup', () => {
	it.each(LOCALES)('labels the personal and admin connections entries differently in %s', (locale) => {
		const dictionary = translation(locale);
		const personal = dictionary[PERSONAL_TITLE_KEY];
		const admin = dictionary[ADMIN_TITLE_KEY];
		expect(personal).toBeTruthy();
		expect(admin).toBeTruthy();
		// Pre-fix, both entries were "外部连接"/"Connections" and an admin saw
		// two identically named tabs in one modal.
		expect(personal).not.toBe(admin);
	});

	it('keeps the personal entry expressing "my connections" and the admin one "provider access"', () => {
		expect(translation('zh-CN')[PERSONAL_TITLE_KEY]).toBe('我的连接');
		expect(translation('zh-CN')[ADMIN_TITLE_KEY]).toBe('服务商接入');
		expect(translation('en-US')[PERSONAL_TITLE_KEY]).toBe('My connections');
		expect(translation('en-US')[ADMIN_TITLE_KEY]).toBe('Provider access');
	});

	it('keeps both tab ids and search prefixes so deep links and search still work', () => {
		expect(MODAL_SOURCE).toContain(`id: '${PERSONAL_CONNECTIONS_ID}'`);
		expect(MODAL_SOURCE).toContain(`id: '${ADMIN_CONNECTIONS_ID}'`);
		expect(MODAL_SOURCE).toContain("searchPrefixes: ['settings.personal.connections.']");
		expect(MODAL_SOURCE).toContain("searchPrefixes: ['settings.admin.connections.']");
	});

	it('still binds each tab to its own title key', () => {
		expect(MODAL_SOURCE).toContain(`titleKey: '${PERSONAL_TITLE_KEY}'`);
		expect(MODAL_SOURCE).toContain(`titleKey: '${ADMIN_TITLE_KEY}'`);
	});

	it('does not retitle any other settings tab', () => {
		// Only the two connections titles were allowed to change.
		const before = JSON.parse(
			readFileSync(
				join(LOCALES_DIR, 'zh-CN', 'translation.json'),
				'utf8'
			)
		);
		const untouched = Object.entries(before).filter(
			([key]) => key !== PERSONAL_TITLE_KEY && key !== ADMIN_TITLE_KEY
		);
		expect(untouched.length).toBeGreaterThan(0);
		for (const [key, value] of untouched) {
			expect(translation('zh-CN')[key]).toBe(value);
		}
	});
});
