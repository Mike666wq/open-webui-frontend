import type { BackgroundSettings } from './schema';

export const OFFICIAL_WELCOME_VIDEO_URL = '/assets/welcome.mp4';
export const OFFICIAL_WELCOME_POSTER_URL = '/assets/welcome.webp';
// The bundled film is fixed at 1280x720. This lets the video mount before
// metadata has loaded; its onloadedmetadata handler still replaces the value
// with the dimensions reported by the browser.
export const OFFICIAL_WELCOME_MEDIA_ASPECT = 16 / 9;

export type PannableBackground = Extract<
	BackgroundSettings,
	{ kind: 'local-image' | 'official-video' }
>;

export function isPannableBackground(
	background: BackgroundSettings
): background is PannableBackground {
	return background.kind === 'local-image' || background.kind === 'official-video';
}

export function backgroundMediaUrl(
	background: BackgroundSettings,
	localImageUrl: string | null
): string | null {
	if (background.kind === 'local-image') return localImageUrl;
	if (background.kind === 'official-video') return OFFICIAL_WELCOME_VIDEO_URL;
	return null;
}
