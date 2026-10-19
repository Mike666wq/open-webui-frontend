import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyAppearanceCss } from './css-vars';
import { DEFAULT_APPEARANCE } from './schema';

type FakeRoot = {
	dataset: Record<string, string>;
	classList: { toggle: (name: string, active: boolean) => void };
	style: { setProperty: (name: string, value: string) => void };
	values: Map<string, string>;
	classes: Set<string>;
};

const fakeRoot = (): FakeRoot => {
	const values = new Map<string, string>();
	const classes = new Set<string>();
	return {
		dataset: {},
		classList: {
			toggle: (name, active) => {
				if (active) classes.add(name);
				else classes.delete(name);
			}
		},
		style: {
			setProperty: (name, value) => values.set(name, value)
		},
		values,
		classes
	};
};

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('appearance CSS tokens', () => {
	it('resolves all six override slots before falling back to global glass values', () => {
		vi.stubGlobal('document', {});
		const root = fakeRoot();
		const settings = structuredClone(DEFAULT_APPEARANCE);
		settings.glass = { opacity: 50, blur: 18, radius: 20, overlayScrim: 40 };
		settings.components = {
			userMessage: { opacity: 61, radius: 10, tint: 9 },
			assistantMessage: { opacity: 62, radius: 11, tint: 8 },
			composer: { opacity: 63, blur: 4, radius: 12 },
			navigation: { opacity: 64, blur: 5, radius: 13 },
			overlay: { opacity: 65, blur: 6, radius: 14 },
			reading: { opacity: 66, blur: 7, radius: 15 }
		};

		applyAppearanceCss(settings, root as unknown as HTMLElement, 'light');

		expect(root.values.get('--mist-user-alpha')).toBe('0.61');
		expect(root.values.get('--mist-user-blur')).toBe('18px');
		expect(root.values.get('--mist-user-radius')).toBe('10px');
		expect(root.values.get('--owui-user-tint-percent')).toBe('9%');
		expect(root.values.get('--mist-assistant-alpha')).toBe('0.62');
		expect(root.values.get('--mist-composer-blur')).toBe('4px');
		expect(root.values.get('--mist-navigation-radius')).toBe('13px');
		expect(root.values.get('--mist-overlay-blur')).toBe('6px');
		expect(root.values.get('--mist-reading-alpha')).toBe('0.66');
	});

	it('is idempotent and marks appearance off without leaving the theme selection ambiguous', () => {
		vi.stubGlobal('document', {});
		const root = fakeRoot();
		const settings = structuredClone(DEFAULT_APPEARANCE);
		applyAppearanceCss(settings, root as unknown as HTMLElement, 'dark');
		const first = [...root.values.entries()];
		applyAppearanceCss(settings, root as unknown as HTMLElement, 'dark');
		expect([...root.values.entries()]).toEqual(first);
		expect(root.dataset.owuiResolvedTheme).toBe('dark');
		expect(root.classes.has('dark')).toBe(true);

		settings.enabled = false;
		applyAppearanceCss(settings, root as unknown as HTMLElement, 'light');
		expect(root.dataset.owuiAppearance).toBe('off');
		expect(root.classes.has('light')).toBe(true);
		expect(root.classes.has('dark')).toBe(false);
	});
});
