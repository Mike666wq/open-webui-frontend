import { get } from 'svelte/store';
import { appearanceSettings } from '$lib/appearance/state';
import { DEFAULT_APPEARANCE } from '$lib/appearance/schema';
import { appearanceStorageKey, legacyAppearanceStorageKey, saveAppearance } from '$lib/appearance/storage';
import { deleteWallpaperAsset, listWallpaperAssets, loadWallpaperAsset } from '$lib/appearance/image-store';
import { markDraftFiles } from './upload-drafts';

export type DeviceCategory = 'cache' | 'drafts' | 'wallpapers' | 'appearance';
export type DeviceUsage = { category: DeviceCategory; count: number; bytes: number | null };

export function managedDraftKeys(storage: Pick<Storage, 'length' | 'key'>): string[] {
	return Array.from({ length: storage.length }, (_, i) => storage.key(i))
		.filter((key): key is string => !!key && /^chat-input(?:-|$)/.test(key));
}

export function managedCacheNames(names: string[]): string[] {
	// An explicit namespace protects unrelated applications on this origin.
	return names.filter((name) => name.startsWith('owui-rebuildable:'));
}

export async function deviceUsage(): Promise<DeviceUsage[]> {
	const drafts = managedDraftKeys(sessionStorage);
	const assets = await listWallpaperAssets();
	let bytes = 0;
	for (const asset of assets) bytes += (await loadWallpaperAsset(asset.id))?.size ?? 0;
	const appearance = [appearanceStorageKey(location.origin), legacyAppearanceStorageKey(location.origin)];
	const names = typeof caches === 'undefined' ? [] : managedCacheNames(await caches.keys());
	return [
		{ category: 'cache', count: names.length, bytes: null },
		{ category: 'drafts', count: drafts.length, bytes: drafts.reduce((n, key) => n + new Blob([sessionStorage.getItem(key) ?? '']).size, 0) },
		{ category: 'wallpapers', count: assets.length, bytes },
		{ category: 'appearance', count: appearance.filter((key) => localStorage.getItem(key)).length,
			bytes: appearance.reduce((n, key) => n + new Blob([localStorage.getItem(key) ?? '']).size, 0) }
	];
}

export async function clearDeviceCategory(category: DeviceCategory): Promise<void> {
	if (category === 'cache') {
		if (typeof caches !== 'undefined') {
			for (const name of managedCacheNames(await caches.keys())) await caches.delete(name);
		}
	} else if (category === 'drafts') {
		for (const key of managedDraftKeys(sessionStorage)) {
			let draft: unknown;
			try { draft = JSON.parse(sessionStorage.getItem(key) ?? '{}'); } catch { draft = {}; }
			await markDraftFiles(draft, false, key);
			sessionStorage.removeItem(key);
		}
	} else if (category === 'wallpapers') {
		// Update references before removing blobs, preserving every non-media setting.
		const next = structuredClone(get(appearanceSettings));
		for (const mode of ['light', 'dark'] as const) {
			next.modes[mode].background = structuredClone(DEFAULT_APPEARANCE.modes[mode].background);
		}
		appearanceSettings.set(saveAppearance(location.origin, next));
		for (const asset of await listWallpaperAssets()) await deleteWallpaperAsset(asset.id);
	} else {
		// Reset configuration without deleting the independent wallpaper library.
		appearanceSettings.set(saveAppearance(location.origin, structuredClone(DEFAULT_APPEARANCE)));
	}
}
