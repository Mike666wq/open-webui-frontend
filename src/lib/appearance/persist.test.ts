import { describe, expect, it, vi } from 'vitest';
import { persistAppearanceChange } from './persist';
import { DEFAULT_APPEARANCE, type AppearanceSettings } from './schema';

const localImageSettings = (assetId: string): AppearanceSettings => {
	const settings = structuredClone(DEFAULT_APPEARANCE);
	settings.modes.light.background = {
		kind: 'local-image',
		assetId,
		focus: { portrait: 0.5, landscape: 0.5 },
		mask: 22,
		blur: 8
	};
	return settings;
};

describe('appearance persistence', () => {
	it('does not write settings when a new wallpaper cannot be stored', async () => {
		const previous = localImageSettings('old');
		const draft = localImageSettings('new');
		const saveSettings = vi.fn((_origin: string, settings: AppearanceSettings) => settings);

		await expect(
			persistAppearanceChange({
				origin: 'https://example.test',
				draft,
				previous,
				pendingBlobs: { new: new Blob(['wallpaper']) },
				saveAsset: vi.fn().mockRejectedValue(new Error('quota exceeded')),
				saveSettings
			})
		).rejects.toThrow(/quota exceeded/);

		expect(saveSettings).not.toHaveBeenCalled();
		expect(previous.modes.light.background).toMatchObject({ assetId: 'old' });
	});

	it('rolls back new media when the settings write fails', async () => {
		const deleteAsset = vi.fn().mockResolvedValue(undefined);
		await expect(
			persistAppearanceChange({
				origin: 'https://example.test',
				draft: localImageSettings('new'),
				previous: localImageSettings('old'),
				pendingBlobs: { new: new Blob(['wallpaper']) },
				saveAsset: vi.fn().mockResolvedValue(undefined),
				saveSettings: vi.fn(() => {
					throw new Error('storage unavailable');
				}),
				deleteAsset
			})
		).rejects.toThrow(/storage unavailable/);
		expect(deleteAsset).toHaveBeenCalledWith('new');
	});

	it('commits the new asset and keeps library images for reuse', async () => {
		const deleteAsset = vi.fn().mockResolvedValue(undefined);
		const result = await persistAppearanceChange({
			origin: 'https://example.test',
			draft: localImageSettings('new'),
			previous: localImageSettings('old'),
			pendingBlobs: { new: new Blob(['wallpaper']) },
			saveAsset: vi.fn().mockResolvedValue(undefined),
			saveSettings: vi.fn((_origin: string, settings: AppearanceSettings) => settings),
			deleteAsset
		});
		expect(result.modes.light.background).toMatchObject({ assetId: 'new' });
		expect(deleteAsset).not.toHaveBeenCalledWith('old');
	});
});
