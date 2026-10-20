import { getUserActiveStatusById } from '$lib/apis/users';

const REFRESH_INTERVAL_MS = 30_000;

/**
 * Subscribes to the official active-status endpoint for one user.
 *
 * The callback runs immediately and then every 30 seconds. It receives
 * `true`/`false` when the endpoint answers and `null` when it fails, so the
 * UI can show "status unavailable" instead of misreporting the user as away.
 */
export const subscribePresence = (
	token: string,
	userId: string,
	callback: (active: boolean | null) => void
): (() => void) => {
	let disposed = false;
	let inFlight = false;

	const refresh = async () => {
		if (disposed || inFlight || !token || !userId) return;
		inFlight = true;
		try {
			const payload = await getUserActiveStatusById(token, userId);
			if (!disposed && typeof payload?.active === 'boolean') {
				callback(payload.active);
			} else if (!disposed) {
				callback(null);
			}
		} catch {
			if (!disposed) callback(null);
		} finally {
			inFlight = false;
		}
	};

	void refresh();
	const interval = setInterval(refresh, REFRESH_INTERVAL_MS);

	return () => {
		disposed = true;
		clearInterval(interval);
	};
};
