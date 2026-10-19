import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE } from './schema';
import {
	appearanceStorageKey,
	loadAppearance,
	normalizeAppearanceOrigin,
	saveAppearance
} from './storage';

class MemoryStorage {
	values = new Map<string, string>();

	getItem(key: string) {
		return this.values.get(key) ?? null;
	}

	setItem(key: string, value: string) {
		this.values.set(key, value);
	}

	removeItem(key: string) {
		this.values.delete(key);
	}
}

describe('origin-scoped appearance storage', () => {
	it('normalizes origins and isolates configurations by origin', () => {
		const storage = new MemoryStorage();
		const alpha = structuredClone(DEFAULT_APPEARANCE);
		alpha.preset = 'teal-slate';
		const beta = structuredClone(DEFAULT_APPEARANCE);
		beta.preset = 'warm-sand';

		expect(normalizeAppearanceOrigin('https://one.example:8443/path?q=1')).toBe(
			'https://one.example:8443'
		);
		saveAppearance('https://one.example/path', alpha, storage);
		saveAppearance('https://two.example/', beta, storage);

		expect(loadAppearance('https://one.example/other', storage).preset).toBe('teal-slate');
		expect(loadAppearance('https://two.example', storage).preset).toBe('warm-sand');
		expect(storage.values.has(appearanceStorageKey('https://third.example'))).toBe(false);
	});

	it('falls back to defaults when an origin contains malformed data', () => {
		const storage = new MemoryStorage();
		storage.setItem(appearanceStorageKey('https://broken.example'), '{');
		expect(loadAppearance('https://broken.example', storage)).toEqual(DEFAULT_APPEARANCE);
	});
});
