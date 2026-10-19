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
		const obsolete = [previous.modes.light.background, previous.modes.dark.background]
			.filter(
				(background): background is Extract<typeof background, { kind: 'local-image' }> =>
					background.kind === 'local-image' && !referenced.has(background.assetId)
			)
			.map((background) => background.assetId);
		await Promise.allSettled(obsolete.map((assetId) => deleteAsset(assetId)));
		return saved;
	} catch (error) {
		await Promise.allSettled(writtenAssets.map((assetId) => deleteAsset(assetId)));
		throw error;
	}
}
