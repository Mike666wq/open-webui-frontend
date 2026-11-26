import { get, readonly, writable } from 'svelte/store';
import { getChatList, getPinnedChatList } from '$lib/apis/chats';
import { shouldMarkChatListAllLoaded } from '$lib/utils/chat-load';

type ChatListItem = {
	id: string;
	[key: string]: unknown;
};

const chatsStore = writable<ChatListItem[] | null>(null);
const pinnedChatsStore = writable<ChatListItem[]>([]);

export const chats = readonly(chatsStore);
export const pinnedChats = readonly(pinnedChatsStore);

let currentPage = 1;
let paginationReady = false;
let requestGeneration = 0;
export let allLoaded = false;
let loadingNextPage = false;

type RefreshChatListOptions = {
	refreshPinned?: boolean;
	clearPinned?: boolean;
};

type ChatListResult = {
	accepted: boolean;
	allLoaded: boolean;
	error?: unknown;
};

export const refreshChatList = async (
	token: string = '',
	options: RefreshChatListOptions = {}
): Promise<ChatListResult> => {
	const generation = ++requestGeneration;
	paginationReady = false;
	loadingNextPage = false;

	const [chatsResult, pinnedResult] = await Promise.all([
		(getChatList(token, 1) as Promise<ChatListItem[]>).then(
			(value) => ({ ok: true as const, value }),
			(error) => ({ ok: false as const, error })
		),
		options.refreshPinned && !options.clearPinned
			? (getPinnedChatList(token) as Promise<ChatListItem[]>).then(
					(value) => ({ ok: true as const, value }),
					(error) => ({ ok: false as const, error })
				)
			: Promise.resolve({ ok: true as const, value: undefined as ChatListItem[] | undefined })
	]);

	if (generation !== requestGeneration) {
		return { accepted: false, allLoaded };
	}

	// Keep the last good list on screen when one of the parallel requests fails.
	// The caller decides whether to show a retry; clearing the store here made
	// the sidebar look permanently empty after a transient failure.
	if (!chatsResult.ok) {
		throw chatsResult.error;
	}

	const nextChats = chatsResult.value;
	currentPage = 1;
	allLoaded = shouldMarkChatListAllLoaded(nextChats.length, false);
	chatsStore.set(nextChats);

	if (options.clearPinned) {
		pinnedChatsStore.set([]);
	} else if (options.refreshPinned && pinnedResult.ok) {
		pinnedChatsStore.set(pinnedResult.value ?? []);
	}

	paginationReady = true;
	return {
		accepted: true,
		allLoaded,
		...(pinnedResult.ok ? {} : { error: pinnedResult.error })
	};
};

// The sidebar owns folder state. This bridge lets other components refresh it.
type FolderRefreshHandler = (folderId?: string | null, chat?: ChatListItem | null) => unknown;
const folderRefreshHandlers = new Set<FolderRefreshHandler>();

export const registerFolderRefreshHandler = (handler: FolderRefreshHandler) => {
	folderRefreshHandlers.add(handler);
	return () => {
		folderRefreshHandlers.delete(handler);
	};
};

export const refreshFolderChatLists = async (
	folderId?: string | null,
	chat?: ChatListItem | null
) => {
	await Promise.all([...folderRefreshHandlers].map((handler) => handler(folderId, chat)));
};

export const refreshSidebar = async (token: string = '') => {
	await Promise.all([
		refreshChatList(token, { refreshPinned: true }),
		refreshFolderChatLists(null),
		refreshFolderChatLists()
	]);
};

export const loadNextChatListPage = async (token: string = ''): Promise<ChatListResult> => {
	if (!paginationReady || allLoaded || loadingNextPage) {
		return { accepted: false, allLoaded };
	}

	const generation = requestGeneration;
	const nextPage = currentPage + 1;
	loadingNextPage = true;

	try {
		let nextChats: ChatListItem[];
		try {
			nextChats = (await getChatList(token, nextPage)) as ChatListItem[];
		} catch (error) {
			if (generation !== requestGeneration) {
				return { accepted: false, allLoaded };
			}
			// A failed page load must not end pagination; retry can ask again.
			return { accepted: false, allLoaded, error };
		}

		if (generation !== requestGeneration) {
			return { accepted: false, allLoaded };
		}

		allLoaded = shouldMarkChatListAllLoaded(nextChats.length, false);
		// A successful empty page is the end of pagination; a failed one must
		// leave currentPage unchanged so the same page can be retried.
		if (nextChats.length > 0) currentPage = nextPage;

		const existingIds = new Set((get(chatsStore) ?? []).map((chat) => chat.id));
		const uniqueChats = nextChats.filter((chat) => !existingIds.has(chat.id));
		chatsStore.set([...(get(chatsStore) ?? []), ...uniqueChats]);

		return { accepted: true, allLoaded };
	} finally {
		loadingNextPage = false;
	}
};

export const setChatActive = (chatId: string, active: boolean): boolean => {
	let found = false;
	const updateChat = (chat: ChatListItem) => {
		if (chat.id !== chatId) {
			return chat;
		}
		found = true;
		return { ...chat, active };
	};

	chatsStore.update((items) => (items ? items.map(updateChat) : items));
	pinnedChatsStore.update((items) => items.map(updateChat));
	return found;
};

export const setChatReadAt = (chatId: string, lastReadAt: number): boolean => {
	let found = false;
	const updateChat = (chat: ChatListItem) => {
		if (chat.id !== chatId) {
			return chat;
		}
		found = true;
		return { ...chat, last_read_at: lastReadAt };
	};

	chatsStore.update((items) => (items ? items.map(updateChat) : items));
	pinnedChatsStore.update((items) => items.map(updateChat));
	return found;
};

export const setAllChatsRead = () => {
	const updateChat = (chat: ChatListItem) => ({ ...chat, last_read_at: chat.updated_at });

	chatsStore.update((items) => (items ? items.map(updateChat) : items));
	pinnedChatsStore.update((items) => items.map(updateChat));
};

export const resetChatListState = () => {
	requestGeneration += 1;
	currentPage = 1;
	paginationReady = false;
	allLoaded = false;
	loadingNextPage = false;
	chatsStore.set(null);
	pinnedChatsStore.set([]);
};
