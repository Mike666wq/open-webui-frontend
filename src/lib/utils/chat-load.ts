/**
 * Fork-local helpers for the "a refreshed conversation disappears" family of
 * reports. They stay pure so the decisions can be tested without mounting the
 * chat component or reaching the API.
 */

export type ChatLoadError = {
	status: number;
	detail: unknown;
};

export const getErrorDetail = (err: unknown) => {
	if (Array.isArray((err as { detail?: unknown })?.detail)) {
		return (err as { detail: { msg?: string }[] }).detail
			.map((e) => e.msg || JSON.stringify(e))
			.join(', ');
	}

	return (err as { detail?: unknown })?.detail ?? err;
};

export const toChatLoadError = (
	err: unknown,
	fallbackStatus: number = 0
): ChatLoadError => {
	const status =
		err && typeof err === 'object' && Number.isFinite((err as { status?: unknown }).status)
			? ((err as { status?: number }).status as number)
			: fallbackStatus;

	const detail =
		err && typeof err === 'object' && Array.isArray((err as { detail?: unknown }).detail)
			? (err as { detail: { msg?: string }[] }).detail
					.map((e) => e.msg || JSON.stringify(e))
					.join(', ')
			: err && typeof err === 'object' && (err as { detail?: unknown }).detail !== undefined
				? (err as { detail: unknown }).detail
				: err;

	return { status, detail };
};

const NOT_FOUND_TEXT = /\bnot[_\s-]?found\b|does not exist|no such chat/i;

export const isChatNotFoundError = (err: unknown): boolean => {
	const parsed = toChatLoadError(err);
	if (parsed.status === 404) return true;
	if (parsed.status !== 0) return false;

	const text = parsed.detail;
	return typeof text === 'string' && NOT_FOUND_TEXT.test(text);
};

export const isChatUnauthorizedError = (err: unknown): boolean => {
	const status = toChatLoadError(err).status;
	return status === 401 || status === 403;
};

export const canReplyToSharedChat = (chat: unknown): boolean =>
	(chat as { chat?: { share_mode?: unknown } })?.chat?.share_mode === 'continue';

export const isSharedReadOnly = (chat: unknown, userId: string | undefined): boolean =>
	chat != null && (chat as { user_id?: unknown }).user_id !== userId && !canReplyToSharedChat(chat);

/**
 * Keep the user's history models when they resolve, but fall back to a usable
 * default when every saved model has since been retired. An explicit empty
 * selection (`[]` / `['']`) is preserved so the user can pick a model.
 */
export const resolveLoadedChatModels = (
	savedModels: string[] | null | undefined,
	availableModelIds: string[],
	fallbackFactory: (savedModels: string[]) => string[]
): string[] => {
	const saved = Array.isArray(savedModels) ? savedModels.filter((id) => Boolean(id)) : [];
	const filtered = saved.filter((id) => availableModelIds.includes(id));

	if (filtered.length > 0) return filtered;
	if (saved.length === 0) return savedModels ? [...savedModels] : [];

	return fallbackFactory(saved);
};

/** A successful but empty page means there is nothing left to paginate. */
export const shouldMarkChatListAllLoaded = (chatCount: number, failed: boolean): boolean =>
	!failed && chatCount === 0;

/**
 * A refresh must not move the user to an old server-side leaf while they have a
 * local unsaved branch: either new messages not present on the server, or a
 * currentId pointing at a local-only message. Keep the local pointer until the
 * next explicit save syncs it.
 */
export const hasUnsavedLocalBranch = (
	baseline: Record<string, any> | null,
	incomingMessages: Record<string, any> | null | undefined,
	incomingCurrentId: string | null | undefined,
	localCurrentId: string | null | undefined,
	localMessages: Record<string, any>
): boolean => {
	const incomingIds = new Set(Object.keys(incomingMessages ?? {}));
	// Only a server snapshot that actually arrived can prove a message is
	// local-only. An empty/undefined snapshot (stream overlay, partial load)
	// must not make a normal multi-message history look unsaved forever.
	const baselineHasExtraMessage =
		incomingIds.size > 0 && Object.keys(baseline ?? {}).some((id) => !incomingIds.has(id));
	const currentIsLocalOnly =
		!!localCurrentId &&
		localCurrentId !== incomingCurrentId &&
		(!incomingIds.size || !incomingIds.has(localCurrentId));

	return baselineHasExtraMessage || currentIsLocalOnly;
};

/**
 * Resolve one navigation's draft snapshot. A later navigation supersedes any
 * request still queued, and the draft key must still match (so a draft that
 * disappeared because it was consumed cannot be restored twice).
 */
export const resolveDraftRestore = <T>(
	request: { generation: number; key: string | null },
	current: { generation: number; key: string | null },
	restore: () => T | Promise<T>,
	fallback: T
): Promise<T> => {
	if (request.generation !== current.generation || request.key !== current.key)
		return Promise.resolve(fallback);
	return Promise.resolve(restore());
};
