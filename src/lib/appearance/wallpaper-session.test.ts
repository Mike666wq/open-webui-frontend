import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE, type AppearanceSettings } from './schema';
import { isWallpaperInUse, planCancelDisposition } from './wallpaper-session';

const withBackgrounds = (
	lightAsset: string | null,
	darkAsset: string | null
): AppearanceSettings => {
	const settings = structuredClone(DEFAULT_APPEARANCE);
	if (lightAsset) {
		settings.modes.light.background = {
			kind: 'local-image',
			assetId: lightAsset,
			focus: { portrait: 0.5, landscape: 0.5 },
			mask: 22,
			blur: 8
		};
	}
	if (darkAsset) {
		settings.modes.dark.background = {
			kind: 'local-image',
			assetId: darkAsset,
			focus: { portrait: 0.5, landscape: 0.5 },
			mask: 22,
			blur: 8
		};
	}
	return settings;
};

const keptNotice = 'wallpaper kept';

describe('appearance wallpaper session', () => {
	it('keeps a newly imported local asset on cancel and tells the user', () => {
		const previous = withBackgrounds(null, null);
		const draft = withBackgrounds('imported', null);
		const blob = new Blob(['imported wallpaper']);

		const result = planCancelDisposition({ imported: blob }, draft, previous, keptNotice);

		expect(result.assetsToPersist).toEqual({ imported: blob });
		expect(result.notice).toBe(keptNotice);
	});

	it('does not discard an asset the previous settings still reference', () => {
		const previous = withBackgrounds('existing', null);
		const draft = withBackgrounds('existing', null);
		const blob = new Blob(['existing wallpaper']);

		const result = planCancelDisposition({ existing: blob }, draft, previous, keptNotice);

		expect(result.assetsToPersist).toEqual({});
		expect(result.notice).toBeNull();
	});

	it('drops a pending blob the cancelled draft no longer references', () => {
		const previous = withBackgrounds(null, null);
		const draft = withBackgrounds(null, null);

		const result = planCancelDisposition(
			{ abandoned: new Blob(['unused']) },
			draft,
			previous,
			keptNotice
		);

		expect(result.assetsToPersist).toEqual({});
		expect(result.notice).toBeNull();
	});

	it('blocks deleting a wallpaper referenced only by a preview in the other mode', () => {
		const draft = withBackgrounds(null, null);
		const previewUrls = { light: 'blob:preview' };

		expect(isWallpaperInUse('preview', draft, [{ id: 'preview', url: 'blob:preview' }], previewUrls)).toBe(true);
		expect(isWallpaperInUse('unrelated', draft, [{ id: 'preview', url: 'blob:preview' }], previewUrls)).toBe(false);
	});

	it('blocks deleting a wallpaper used by either draft mode', () => {
		const draft = withBackgrounds('light-image', 'dark-image');

		expect(isWallpaperInUse('dark-image', draft, [], {})).toBe(true);
		expect(isWallpaperInUse('light-image', draft, [], {})).toBe(true);
	});
});
