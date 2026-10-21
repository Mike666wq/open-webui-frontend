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

/**
 * Commits media before settings. If either step fails, settings are left
 * untouched and assets introduced by this attempt are removed.
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
	try {
		for (const [assetId, blob] of Object.entries(pendingBlobs)) {
			await saveAsset(assetId, blob);
			writtenAssets.push(assetId);
		}

		const saved = saveSettings(origin, draft);
		const referenced = new Set(
			[saved.modes.light.background, saved.modes.dark.background]
				.filter((background) => background.kind === 'local-image')
				.map((background) => background.assetId)
		);
		// With a multi-image library, images that are no longer the active
		// background stay in the library for reuse; they are only removed via an
		// explicit delete in the editor, not as a side effect of switching.
		return saved;
	} catch (error) {
		await Promise.allSettled(writtenAssets.map((assetId) => deleteAsset(assetId)));
		throw error;
	}
}
