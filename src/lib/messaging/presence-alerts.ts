import { toast } from 'svelte-sonner';
import { get } from 'svelte/store';

import { settings, playingNotificationSound, isLastActiveTab, channels } from '$lib/stores';
import { getUserActiveStatusById } from '$lib/apis/users';
import { getChannels } from '$lib/apis/channels';
import type { DirectoryUser } from './types';
import { isNativeNotifyAvailable, postNativeNotification } from './native-notify';

type PresenceAlertSettings = {
	enabled?: boolean;
	popup?: boolean;
	sound?: boolean;
};

const readAlertSettings = (): PresenceAlertSettings => {
	const value = get(settings) as Record<string, unknown> | undefined;
	const raw = value?.presenceAlerts;
	if (!raw || typeof raw !== 'object') return {};
	return raw as PresenceAlertSettings;
};

const playAlertSound = () => {
	if (typeof window === 'undefined') return;
	// When the Android shell owns system notifications it also owns the sound;
	// playing the web copy too would double every alert.
	if (isNativeNotifyAvailable()) return;
	// Respect the same global sound switch and single-playback guard used by
	// chat notifications so alerts never overlap.
	if (!(get(settings)?.notificationSound ?? true)) return;
	if (get(playingNotificationSound) || !get(isLastActiveTab)) return;

	playingNotificationSound.set(true);
	const audio = new Audio('/audio/notification.mp3');
	audio.play().finally(() => {
		playingNotificationSound.set(false);
	});
};

const showAlertPopup = (member: DirectoryUser) => {
	toast.success(`${member.name} is now active`, {
		description: member.status_message ? String(member.status_message) : undefined
	});
};

const POLL_INTERVAL_MS = 30_000;

/**
 * In the Android shell the WebView keeps running while the app is in the
 * background, but `document.visibilityState` flips to hidden. Polling must
 * continue there so the native layer can raise system notifications; only the
 * in-app popup is suppressed in the background.
 */
const shouldPoll = () => {
	if (typeof document === 'undefined') return true;
	return document.visibilityState === 'visible' || isNativeNotifyAvailable();
};

/**
 * Watches the user's DM partners and fires a popup and/or a sound whenever one
 * of them transitions from not-active to active.
 *
 * This runs independently of the messages page so the alert works anywhere in
 * the app. It polls the official per-user active-status endpoint only for DM
 * partners (never the whole member directory), at a 30s cadence, and stops in
 * the background.
 *
 * Entirely opt-in: nothing runs unless the user enabled the master toggle.
 */
export const subscribePresenceAlerts = (
	token: string,
	currentUserId: string | null
): (() => void) => {
	const lastKnownActive = new Map<string, boolean>();
	const partnerNames = new Map<string, string>();
	let baselineReady = false;
	let disposed = false;
	let timer: ReturnType<typeof setInterval> | null = null;
	let inFlight = false;

	// Ensure the channel list is loaded so we know who the DM partners are. The
	// sidebar usually populates it, but the alert must work on pages where the
	// sidebar never opened.
	if ((get(channels) ?? []).length === 0) {
		getChannels(token)
			.then((list) => {
				if (!disposed && Array.isArray(list)) channels.set(list);
			})
			.catch(() => {});
	}

	const getDmPartners = (): DirectoryUser[] => {
		const currentChannels = get(channels) ?? [];
		return currentChannels
			.filter((channel: any) => channel?.type === 'dm')
			.flatMap((channel: any) => channel?.users ?? [])
			.filter((member: any) => member?.id && member.id !== currentUserId);
	};

	const poll = async () => {
		if (disposed || inFlight) return;
		const prefs = readAlertSettings();
		if (!prefs.enabled || !token) return;
		if (!shouldPoll()) return;

		const partners = getDmPartners();
		if (!partners.length) return;

		inFlight = true;
		try {
			await Promise.all(
				partners.map(async (partner) => {
					partnerNames.set(partner.id, partner.name);
					try {
						const payload = await getUserActiveStatusById(token, partner.id);
						if (disposed || typeof payload?.active !== 'boolean') return;

						const wasActive = lastKnownActive.get(partner.id);
						const isActive = payload.active;

						if (baselineReady && wasActive === false && isActive) {
							const inBackground =
								typeof document !== 'undefined' && document.visibilityState !== 'visible';
							if (isNativeNotifyAvailable() && inBackground) {
								postNativeNotification({
									type: 'member-active',
									userId: partner.id,
									name: partner.name
								});
							} else {
								if (prefs.popup ?? true) showAlertPopup(partner);
								if (prefs.sound ?? true) playAlertSound();
							}
						}
						lastKnownActive.set(partner.id, isActive);
					} catch {
						// Network failure must never be reported as offline; keep prior state.
					}
				})
			);
			baselineReady = true;
		} finally {
			inFlight = false;
		}
	};

	void poll();
	timer = setInterval(poll, POLL_INTERVAL_MS);

	const handleVisibility = () => {
		if (document.visibilityState === 'visible') void poll();
	};
	if (typeof document !== 'undefined') {
		document.addEventListener('visibilitychange', handleVisibility);
	}

	return () => {
		disposed = true;
		if (timer) clearInterval(timer);
		if (typeof document !== 'undefined') {
			document.removeEventListener('visibilitychange', handleVisibility);
		}
	};
};

// Test seam: the transition detector is exported pure for unit tests.
export const detectCameOnline = (
	previous: Map<string, boolean>,
	users: DirectoryUser[],
	baselineReady: boolean
): DirectoryUser[] => {
	if (!baselineReady) return [];
	return users.filter(
		(member) =>
			typeof member.is_active === 'boolean' &&
			previous.get(member.id) === false &&
			member.is_active === true
	);
};
