/**
 * Bridge from the web UI to the native Android shell.
 *
 * The Android client installs `window.__openWebUiNotify` only when it can back
 * it with real system notifications. In a regular browser the bridge is
 * absent and every helper here is a no-op, so all logic must stay usable
 * without it.
 *
 * The bridge is fire-and-forget: the page never reads data back from native,
 * and native must treat every field as untrusted display text.
 */

export type NativeNotifyPayload =
	| {
			type: 'message';
			channelId: string;
			messageId?: string;
			title: string;
			text: string;
			senderId?: string;
			isDm: boolean;
	  }
	| {
			type: 'member-active';
			userId: string;
			name: string;
	  };

type NativeNotifyBridge = {
	post?: (payload: string) => void;
};

const readBridge = (): NativeNotifyBridge | null => {
	const scope =
		typeof window !== 'undefined'
			? window
			: typeof globalThis !== 'undefined'
				? globalThis
				: null;
	if (!scope) return null;
	const candidate = (scope as unknown as { __openWebUiNotify?: NativeNotifyBridge })
		.__openWebUiNotify;
	if (!candidate || typeof candidate.post !== 'function') return null;
	return candidate;
};

export const isNativeNotifyAvailable = (): boolean => readBridge() !== null;

const clampText = (value: string, max: number): string => {
	const trimmed = value.replace(/\s+/g, ' ').trim();
	return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
};

/**
 * Forward an event to the Android shell. Returns true when a bridge accepted
 * the payload; callers may use that to skip their own duplicate in-app toast.
 * The payload is serialized here so native parsing never touches page objects.
 */
export const postNativeNotification = (payload: NativeNotifyPayload): boolean => {
	const bridge = readBridge();
	if (!bridge) return false;
	const post = bridge.post;
	if (typeof post !== 'function') return false;
	try {
		const safe =
			payload.type === 'message'
				? {
						...payload,
						title: clampText(String(payload.title ?? ''), 80),
						text: clampText(String(payload.text ?? ''), 160),
						channelId: clampText(String(payload.channelId ?? ''), 64),
						messageId: payload.messageId ? clampText(String(payload.messageId), 64) : undefined,
						senderId: payload.senderId ? clampText(String(payload.senderId), 64) : undefined,
						isDm: payload.isDm === true
					}
				: {
						...payload,
						userId: clampText(String(payload.userId ?? ''), 64),
						name: clampText(String(payload.name ?? ''), 80)
					};
		post(JSON.stringify(safe));
		return true;
	} catch {
		return false;
	}
};
