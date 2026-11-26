import type {
	AppearanceSettings,
	BackgroundSettings,
	LocalImageBackground,
	ResolvedAppearanceTheme
} from './schema';

type LocalAssetSettings = Pick<AppearanceSettings, 'modes'>;
type LibraryItem = { id: string; url: string };
type PreviewUrls = Partial<Record<ResolvedAppearanceTheme, string>>;

const isLocalImage = (background: BackgroundSettings): background is LocalImageBackground =>
	background.kind === 'local-image';

/** True when a wallpaper is used by either mode or still shown in any preview. */
export function isWallpaperInUse(
	assetId: string,
	settings: LocalAssetSettings,
	previewLibrary: ReadonlyArray<LibraryItem>,
	previewUrls: Readonly<PreviewUrls>
): boolean {
	const active = [settings.modes.light.background, settings.modes.dark.background].some(
		(background) => isLocalImage(background) && background.assetId === assetId
	);
	if (active) return true;
	// A preview URL is a live object URL for a library image. Even if the draft
	// has moved on to another background, revoking it would break the preview.
	const assetUrl = previewLibrary.find((item) => item.id === assetId)?.url;
	if (!assetUrl) return false;
	return Object.values(previewUrls).includes(assetUrl);
}

export type CancelDisposition = {
	/** Pending blobs that must be written before closing so the import survives. */
	assetsToPersist: Record<string, Blob>;
	/** Notice shown to the user; null means a quiet cancel is correct. */
	notice: string | null;
};

/**
 * Decide what cancelling an appearance session must do with imported wallpapers.
 * A pending blob is only in memory: adding it to the editor's `library` (as
 * chooseWallpaper does immediately) does not persist it to IndexedDB. Any
 * pending blob the draft still references must therefore be committed on
 * cancel, or the user silently loses the image. Blobs the draft no longer
 * references are intentionally dropped along with the rest of the draft.
 */
export function planCancelDisposition(
	pendingBlobs: Readonly<Record<string, Blob>>,
	draft: LocalAssetSettings,
	previous: LocalAssetSettings,
	keptNotice: string
): CancelDisposition {
	const referenced = (settings: LocalAssetSettings) =>
		new Set(
			[settings.modes.light.background, settings.modes.dark.background]
				.filter(isLocalImage)
				.map((background) => background.assetId)
		);

	const previousReferenced = referenced(previous);
	const draftReferenced = referenced(draft);
	const assetsToPersist: Record<string, Blob> = {};

	for (const [assetId, blob] of Object.entries(pendingBlobs)) {
		// The previous settings already point at this asset: it must have been
		// persisted before this editor session, so leave it untouched.
		if (previousReferenced.has(assetId)) continue;
		if (draftReferenced.has(assetId)) assetsToPersist[assetId] = blob;
	}

	return {
		assetsToPersist,
		notice: Object.keys(assetsToPersist).length ? keptNotice : null
	};
}
