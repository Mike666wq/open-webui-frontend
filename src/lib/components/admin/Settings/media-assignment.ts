/**
 * Presentation rules for the media assignment screen.
 *
 * These live apart from the component so the decisions that matter — which
 * connection may back a purpose every user calls, and what to say when a
 * connection has no usable model — can be tested without mounting Svelte.
 */

import type { MediaAssignmentCandidate, MediaAssignmentPurpose } from '$lib/apis/providers';

/** A purpose is an instance-wide feature, so only a shared connection may back it. */
export const canBackInstancePurpose = (candidate: MediaAssignmentCandidate): boolean =>
	candidate.visibility === 'shared';

/**
 * Why a connection cannot be picked, or null when it can.
 *
 * A private connection is listed rather than filtered out: hiding it leaves an
 * administrator wondering why the connection they just created is absent.
 */
export const connectionBlockedReason = (
	candidate: MediaAssignmentCandidate
): 'private' | 'no-models' | null => {
	if (!canBackInstancePurpose(candidate)) return 'private';
	if (candidate.models.length === 0) return 'no-models';
	return null;
};

/**
 * The empty-whitelist case is the one that used to end in a bare 400 from the
 * server ("Select an image model for this provider connection") with nothing
 * telling the administrator where to add one. Say it in the list instead.
 */
export const emptyWhitelistHint = (
	purposeLabel: string,
	t: (key: string, options?: Record<string, unknown>) => string = (key) => key
): string => t('settings.admin.media.noModelsHint', { purpose: purposeLabel });

/** Realtime voice has no media adapter yet; the screen says so instead of hiding it. */
export const isAssignable = (purpose: MediaAssignmentPurpose): boolean =>
	purpose.purpose !== 'realtime';

export const modeLabel = (
	mode: MediaAssignmentPurpose['mode'],
	t: (key: string) => string = (key) => key
): string => t(`settings.admin.media.mode.${mode}`);

/**
 * The credential is write-only, so the field can only say whether one exists.
 * Showing "已保存" is what makes an empty password box read as "unchanged"
 * rather than "you have no key".
 */
export const secretPlaceholder = (
	hasKey: boolean,
	t: (key: string) => string = (key) => key
): string => t(hasKey ? 'settings.admin.media.keyStored' : 'settings.admin.media.keyMissing');

/** A purpose is usable only when it resolves to a callable target. */
export const isReady = (purpose: MediaAssignmentPurpose): boolean => purpose.ready;

/**
 * The one-line reason to show under a not-ready purpose.
 *
 * Reasons arrive from the server already phrased for the administrator; taking
 * the first keeps the row readable while still surfacing the actionable part.
 */
export const primaryReason = (purpose: MediaAssignmentPurpose): string =>
	purpose.reasons.length > 0 ? purpose.reasons[0].message : '';
