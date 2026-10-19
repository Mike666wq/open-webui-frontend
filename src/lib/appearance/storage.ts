import {
	DEFAULT_APPEARANCE,
	normalizeAppearance,
	type AppearanceSettings
} from './schema';

export const APPEARANCE_STORAGE_PREFIX = 'owui-appearance:v3:';
export const LEGACY_APPEARANCE_STORAGE_PREFIX = 'owui-appearance:v2:';

export function normalizeAppearanceOrigin(origin: string): string {
	if (!origin) return '';
	try {
		return new URL(origin).origin;
	} catch {
		return origin.trim().replace(/\/+$/, '');
	}
}

export const appearanceStorageKey = (origin: string) =>
	`${APPEARANCE_STORAGE_PREFIX}${normalizeAppearanceOrigin(origin)}`;

export const legacyAppearanceStorageKey = (origin: string) =>
	`${LEGACY_APPEARANCE_STORAGE_PREFIX}${normalizeAppearanceOrigin(origin)}`;

type StorageReader = Pick<Storage, 'getItem'>;
type StorageWriter = Pick<Storage, 'setItem'> & Partial<Pick<Storage, 'removeItem'>>;

export function loadAppearance(
	origin: string,
	storage: StorageReader | null = typeof localStorage === 'undefined' ? null : localStorage
): AppearanceSettings {
	if (!storage) return structuredClone(DEFAULT_APPEARANCE);

	try {
		const current = storage.getItem(appearanceStorageKey(origin));
		if (current) return normalizeAppearance(JSON.parse(current));
		const legacy = storage.getItem(legacyAppearanceStorageKey(origin));
		return legacy
			? normalizeAppearance(JSON.parse(legacy))
			: structuredClone(DEFAULT_APPEARANCE);
	} catch {
		return structuredClone(DEFAULT_APPEARANCE);
	}
}

export function saveAppearance(
	origin: string,
	settings: AppearanceSettings,
	storage: StorageWriter | null = typeof localStorage === 'undefined' ? null : localStorage
): AppearanceSettings {
	const normalized = normalizeAppearance(settings);
	if (!storage) return normalized;
	storage.setItem(appearanceStorageKey(origin), JSON.stringify(normalized));
	storage.removeItem?.(legacyAppearanceStorageKey(origin));
	return normalized;
}
