import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE } from './schema';
import { parseThemeFile, serializeThemeFile, THEME_FILE_FORMAT } from './theme-file';

const current = structuredClone(DEFAULT_APPEARANCE);
current.modes.light.background = {
	kind: 'local-image',
	assetId: 'private-wallpaper',
	focus: { portrait: 0.35, landscape: 0.5 },
	mask: 41,
	blur: 9
};
current.directoryEnabled = false;

describe('theme files', () => {
	it('never serializes wallpaper, origin, credentials or chat content', () => {
		const text = serializeThemeFile(current);
		const parsed = JSON.parse(text);
		expect(parsed.format).toBe(THEME_FILE_FORMAT);
		expect(parsed.version).toBe(5);
		expect(text).not.toContain('private-wallpaper');
		expect(text).not.toContain('assetId');
		expect(text).not.toContain('token');
		expect(text).not.toContain('192.168');
	});

	it('imports a full theme while preserving all local media and directory state', () => {
		const imported = parseThemeFile(serializeThemeFile(current), current);
		expect(imported.modes.light.background).toEqual(current.modes.light.background);
		expect(imported.modes.dark.background).toEqual(DEFAULT_APPEARANCE.modes.dark.background);
		expect(imported.directoryEnabled).toBe(current.directoryEnabled);
		expect(imported.layout).toEqual(current.layout);
	});

	it('rejects malformed JSON and wrong file versions', () => {
		expect(() => parseThemeFile('{', current)).toThrow(/valid JSON/);
		expect(() =>
			parseThemeFile(
				JSON.stringify({ format: THEME_FILE_FORMAT, version: 2, theme: {} }),
				current
			)
		).toThrow(/version/);
	});

	it('rejects the whole file when one field is invalid', () => {
		const file = JSON.parse(serializeThemeFile(current));
		file.theme.reading.fontSize = 41;
		expect(() => parseThemeFile(JSON.stringify(file), current)).toThrow(/fontSize/);
		const withCss = JSON.parse(serializeThemeFile(current));
		withCss.theme.lightColors.accent = 'url(javascript:alert(1))';
		expect(() => parseThemeFile(JSON.stringify(withCss), current)).toThrow(/hex colour/);
		const unsupported = JSON.parse(serializeThemeFile(current));
		unsupported.theme.components.overlay = { css: 'body{display:none}' };
		expect(() => parseThemeFile(JSON.stringify(unsupported), current)).toThrow(
			/not supported/
		);
		const unknownSlot = JSON.parse(serializeThemeFile(current));
		unknownSlot.theme.components.unknownSurface = { opacity: 75 };
		expect(() => parseThemeFile(JSON.stringify(unknownSlot), current)).toThrow(
			/unknownSurface is not supported/
		);
	});
});
