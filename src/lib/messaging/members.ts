import { getUserActiveStatusById, searchUsers } from '$lib/apis/users';
import type { DirectoryUser, MessageChannel, MessageMember } from './types';

const CACHE_TTL_MS = 30_000;
const MAX_PARALLEL_REQUESTS = 4;

type UserSearchResponse = {
	users?: MessageMember[];
	total?: number;
};

type MemberMeta = {
	loading: boolean;
	total: number | null;
	hasMore: boolean;
};

type CacheState = {
	users: Map<string, DirectoryUser>;
	loading: boolean;
	loadedAt: number;
	page: number;
	total: number | null;
	query: string;
	generation: number;
};

type Subscriber = (users: DirectoryUser[], meta: MemberMeta) => void;

type MemberDirectoryDependencies = {
	searchUsers: typeof searchUsers;
	getUserActiveStatusById: typeof getUserActiveStatusById;
};

const defaultDependencies: MemberDirectoryDependencies = {
	searchUsers,
	getUserActiveStatusById
};

let dependencies = defaultDependencies;

const emptyState = (query = ''): CacheState => ({
	users: new Map(),
	loading: false,
	loadedAt: 0,
	page: 0,
	total: null,
	query,
	generation: 0
});

let state = emptyState();
let subscribers: Subscriber[] = [];
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let currentToken = '';
let currentUserId: string | null = null;
let visibleUserIds: string[] = [];
let watchedUserIds: string[] = [];
let pendingStatusUserIds: string[] = [];
let activeStatusRequests = 0;
let statusPump: Promise<void> | null = null;

const hasMore = (cache: CacheState) => cache.total === null || cache.users.size < cache.total;

const publish = () => {
	const users = [...state.users.values()].sort((a, b) => {
		if (a.is_active !== b.is_active) {
			if (a.is_active === null || a.is_active === undefined) return 1;
			if (b.is_active === null || b.is_active === undefined) return -1;
			return a.is_active ? -1 : 1;
		}
		return a.name.localeCompare(b.name);
	});
	const meta = {
		loading: state.loading,
		total: state.total,
		hasMore: hasMore(state)
	};
	subscribers.forEach((subscriber) => subscriber(users, meta));
};

const upsertUsers = (users: MessageMember[], currentUser: string | null) => {
	for (const user of users) {
		if (!user?.id || user.id === currentUser || user.role === 'pending') continue;
		const previous: Partial<DirectoryUser> = state.users.get(user.id) ?? {};
		state.users.set(user.id, {
			...previous,
			...user,
			// Search results do not prove presence. Keep it unknown until the
			// dedicated active-status endpoint answers.
			is_active: previous.is_active ?? null
		});
	}
};

const requestPage = async (token: string, page: number, generation: number) => {
	const response = (await dependencies.searchUsers(
		token,
		state.query || undefined,
		'name',
		'asc',
		page - 1
	)) as UserSearchResponse | null;

	if (generation !== state.generation) return false;

	const users = response?.users ?? [];
	upsertUsers(users, currentUserId);
	state.total = typeof response?.total === 'number' ? response.total : state.total;
	state.page = Math.max(state.page, page);
	state.loadedAt = Date.now();
	return users.length > 0;
};

const drainStatusQueue = async (token: string) => {
	if (!pendingStatusUserIds.length || activeStatusRequests >= MAX_PARALLEL_REQUESTS) return;

	const batch: Promise<void>[] = [];
	while (pendingStatusUserIds.length && activeStatusRequests < MAX_PARALLEL_REQUESTS) {
		const userId = pendingStatusUserIds.shift();
		if (!userId || !state.users.has(userId)) continue;

		activeStatusRequests += 1;
		const generation = state.generation;
		const request = (async () => {
			try {
				const payload = await dependencies.getUserActiveStatusById(token, userId);
				if (generation !== state.generation) return;
				const member = state.users.get(userId);
				if (!member || typeof payload?.active !== 'boolean') return;
				state.users.set(userId, { ...member, is_active: payload.active });
			} catch {
				if (generation !== state.generation) return;
				const member = state.users.get(userId);
				if (member) state.users.set(userId, { ...member, is_active: null });
			} finally {
				activeStatusRequests -= 1;
				publish();
				void drainStatusQueue(token);
			}
		})();
		batch.push(request);
	}

	await Promise.all(batch);
};

const queueVisibleStatusRefresh = (token: string, force = false) => {
	if (!token) return;
	if (
		!force &&
		Date.now() - state.loadedAt < CACHE_TTL_MS &&
		visibleUserIds.length === 0 &&
		watchedUserIds.length === 0
	) {
		return;
	}

	const queued = new Set(pendingStatusUserIds);
	for (const userId of [...visibleUserIds, ...watchedUserIds]) {
		if (state.users.has(userId) && !queued.has(userId)) {
			pendingStatusUserIds.push(userId);
			queued.add(userId);
		}
	}

	if (!statusPump) {
		statusPump = drainStatusQueue(token).finally(() => {
			statusPump = null;
			if (pendingStatusUserIds.length) queueVisibleStatusRefresh(token, true);
		});
	}
};

export const subscribeMembers = (token: string, userId: string | null, subscriber: Subscriber) => {
	currentToken = token;
	currentUserId = userId;
	subscribers.push(subscriber);
	publish();

	if (!state.page && !state.loading) void loadMoreMembers(token, userId);

	if (!refreshTimer) {
		refreshTimer = setInterval(() => {
			state.loadedAt = 0;
			queueVisibleStatusRefresh(currentToken, true);
		}, 30_000);
	}

	return () => {
		subscribers = subscribers.filter((item) => item !== subscriber);
		if (!subscribers.length && refreshTimer) {
			clearInterval(refreshTimer);
			refreshTimer = null;
		}
	};
};

export const setMemberDirectoryQuery = (token: string, userId: string | null, query: string) => {
	const normalized = query.trim();
	if (normalized === state.query) return;

	currentToken = token;
	currentUserId = userId;
	state = emptyState(normalized);
	state.generation += 1;
	visibleUserIds = [];
	pendingStatusUserIds = [];
	publish();
	void loadMoreMembers(token, userId);
};

export const loadMoreMembers = async (token: string, userId: string | null) => {
	if (!token || state.loading || !hasMore(state)) return;
	currentToken = token;
	currentUserId = userId;
	state.loading = true;
	publish();
	const generation = state.generation;
	try {
		await requestPage(token, state.page + 1, generation);
	} catch {
		if (generation === state.generation) {
			state.loadedAt = 0;
			state.total = null;
		}
	} finally {
		if (generation === state.generation) {
			state.loading = false;
			publish();
			queueVisibleStatusRefresh(token);
		}
	}
};

export const setVisibleMemberIds = (ids: string[]) => {
	const nextIds = [...new Set(ids)];
	const membershipChanged =
		nextIds.length !== visibleUserIds.length ||
		nextIds.some((id, index) => id !== visibleUserIds[index]);
	if (!membershipChanged) return;
	visibleUserIds = nextIds;
	queueVisibleStatusRefresh(currentToken);
};

/**
 * Registers a set of members whose presence should be kept fresh even when
 * they are not visible in the directory list. Used by the opt-in "member came
 * online" alert so it can notice away → active transitions for people the
 * user actually converses with, without polling every registered account.
 */
export const setWatchedMemberIds = (ids: string[]) => {
	const nextIds = [...new Set(ids)];
	const membershipChanged =
		nextIds.length !== watchedUserIds.length ||
		nextIds.some((id, index) => id !== watchedUserIds[index]);
	if (!membershipChanged) return;
	watchedUserIds = nextIds;
	queueVisibleStatusRefresh(currentToken, true);
};

export const resetMemberDirectory = () => {
	if (refreshTimer) {
		clearInterval(refreshTimer);
		refreshTimer = null;
	}
	state = emptyState();
	state.generation += 1;
	subscribers = [];
	visibleUserIds = [];
	pendingStatusUserIds = [];
	currentToken = '';
	currentUserId = null;
};

export const enrichDmChannels = (channels: MessageChannel[]) => {
	for (const channel of channels) {
		if (channel.type !== 'dm') continue;
		for (const user of channel.users ?? []) {
			const cached = state.users.get(user.id);
			if (!cached) continue;
			Object.assign(user, cached);
		}
	}
};

export const hasDirectoryLoaded = () => state.loadedAt > 0 && state.users.size > 0;

// Test seam. Keeping it internal prevents callers from swapping production APIs.
export const __setMemberDirectoryDependenciesForTests = (
	next: Partial<MemberDirectoryDependencies>
) => {
	dependencies = { ...defaultDependencies, ...next };
};
