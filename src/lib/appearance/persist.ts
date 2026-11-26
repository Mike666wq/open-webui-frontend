import { deleteWallpaperAsset, saveWallpaperAsset } from './image-store';
import type { AppearanceSettings } from './schema';
import { saveAppearance } from './storage';

type PersistAppearanceInput = {
	origin: string;
	draft: AppearanceSettings;
	previous: AppearanceSettings;
	pendingBlobs: Readonly<Record<string, Blob>>;
	saveAsset?: (assetId: string, blob: Blob) => Promise<void>;
	saveSettings?: (origin: string, settings: AppearanceSettings) => AppearanceSettings;
	deleteAsset?: (assetId: string) => Promise<void>;
};

const referencedAssetIds = (settings: AppearanceSettings): Set<string> =>
	new Set(
		[settings.modes.light.background, settings.modes.dark.background]
			.filter((background) => background.kind === 'local-image')
			.map((background) => background.assetId)
	);

/**
 * Commits media before settings. A failed settings write rolls back only the
 * assets that are new to this attempt (not those that the previous settings
 * still reference). A successful write removes assets written by this attempt
 * that the saved settings no longer reference.
 */
export async function persistAppearanceChange({
	origin,
	draft,
	previous,
	pendingBlobs,
	saveAsset = saveWallpaperAsset,
	saveSettings = saveAppearance,
	deleteAsset = deleteWallpaperAsset
}: PersistAppearanceInput): Promise<AppearanceSettings> {
	const writtenAssets: string[] = [];
	const previousReferenced = referencedAssetIds(previous);
	try {
		for (const [assetId, blob] of Object.entries(pendingBlobs)) {
			await saveAsset(assetId, blob);
			writtenAssets.push(assetId);
		}

		const saved = saveSettings(origin, draft);
		const savedReferenced = referencedAssetIds(saved);
		// Images orphaned by a settings change are only removed here, immediately
		// after their write; switching backgrounds does not prune the library.
		await Promise.allSettled(
			writtenAssets
				.filter((assetId) => !savedReferenced.has(assetId))
				.map((assetId) => deleteAsset(assetId))
		);
		return saved;
	} catch (error) {
		// An asset already referenced by the previous settings must remain: the
		// settings write failed, so the saved appearance may still point at it.
		await Promise.allSettled(
			writtenAssets
				.filter((assetId) => !previousReferenced.has(assetId))
				.map((assetId) => deleteAsset(assetId))
		);
		throw error;
	}
}
