import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { resolveDefaultModelIds, sanitizeHistory } from './index';
import {
	toChatLoadError,
	isChatNotFoundError,
	isChatUnauthorizedError,
	isSharedReadOnly,
	resolveLoadedChatModels,
	shouldMarkChatListAllLoaded,
	hasUnsavedLocalBranch,
	resolveDraftRestore
} from './chat-load';

describe('getChatById error parsing', () => {
	it('keeps detail compatible with the rest of the API layer', () => {
		expect(toChatLoadError({ status: 404, detail: 'Chat not found' })).toEqual({
			status: 404,
			detail: 'Chat not found'
		});
		expect(toChatLoadError({ status: 422, detail: [{ msg: 'first' }, { msg: 'second' }] })).toEqual(
			{ status: 422, detail: 'first, second' }
		);
	});

	it('uses the response status for a network/JSON failure or non-JSON body', () => {
		expect(toChatLoadError(new Error('network down'), 500)).toEqual({
			status: 500,
			detail: new Error('network down')
		});
	});

	it('distinguishes not-found, unauthorized and server/network errors', () => {
		expect(isChatNotFoundError({ status: 404, detail: 'missing chat' })).toBe(true);
		expect(isChatNotFoundError({ status: 500, detail: 'Chat not found' })).toBe(false);
		expect(isChatNotFoundError({ detail: 'Chat not found' })).toBe(true);
		expect(isChatNotFoundError({ detail: 'network down' })).toBe(false);
		expect(isChatUnauthorizedError({ status: 401, detail: 'expired' })).toBe(true);
		expect(isChatUnauthorizedError({ status: 403, detail: 'forbidden' })).toBe(true);
		expect(isChatUnauthorizedError({ status: 500, detail: 'oops' })).toBe(false);
	});
});

describe('shared chat read-only decision', () => {
	const owner = { user_id: 'alice', chat: { share_mode: null } };
	const sharedReadOnly = { user_id: 'alice', chat: { share_mode: null } };
	const sharedContinue = { user_id: 'alice', chat: { share_mode: 'continue' } };

	it('lets the owner edit regardless of share mode', () => {
		expect(isSharedReadOnly(owner, 'alice')).toBe(false);
	});

	it('treats a normal foreign share as read-only', () => {
		expect(isSharedReadOnly(sharedReadOnly, 'bob')).toBe(true);
	});

	it('lets a foreign continue-mode share reply and save', () => {
		expect(isSharedReadOnly(sharedContinue, 'bob')).toBe(false);
	});
});

describe('selectedModels recovery on chat load', () => {
	const fallback = (ids: string[]) => (ids.some((id) => id) ? [`default-${ids[0]}`] : ['default']);

	it('keeps saved models that still exist', () => {
		expect(resolveLoadedChatModels(['a', 'b'], ['a', 'b', 'c'], fallback)).toEqual(['a', 'b']);
	});

	it('falls back when every saved model has been retired', () => {
		expect(resolveLoadedChatModels(['old'], ['new'], fallback)).toEqual(['default-old']);
		expect(resolveDefaultModelIds([{ id: 'new' }], ['old'])).toEqual(['new']);
	});

	it('does not override an explicit empty selection', () => {
		expect(resolveLoadedChatModels([], ['new'], fallback)).toEqual([]);
		expect(resolveLoadedChatModels([''], ['new'], fallback)).toEqual(['']);
	});
});

describe('chat list pagination guard', () => {
	it('marks all loaded only for a successful empty page', () => {
		expect(shouldMarkChatListAllLoaded(0, false)).toBe(true);
		expect(shouldMarkChatListAllLoaded(0, true)).toBe(false);
		expect(shouldMarkChatListAllLoaded(3, false)).toBe(false);
	});
});

describe('continue-chat refresh merge guard', () => {
	it('keeps the local currentId when the server leaf is not the local branch', () => {
		expect(
			hasUnsavedLocalBranch(
				{ a: { id: 'a' }, local: { id: 'local' } },
				{ a: { id: 'a' } },
				'a',
				'local',
				{ a: { id: 'a' }, local: { id: 'local' } }
			)
		).toBe(true);
	});

	it('detects a baseline with messages missing from the incoming snapshot', () => {
		expect(
			hasUnsavedLocalBranch(
				{ a: { id: 'a' }, extra: { id: 'extra' } },
				{ a: { id: 'a' } },
				'a',
				'a',
				{ a: { id: 'a' }, extra: { id: 'extra' } }
			)
		).toBe(true);
	});

	it('allows a clean refetch to follow the server currentId', () => {
		expect(
			hasUnsavedLocalBranch({ a: { id: 'a' } }, { a: { id: 'a' } }, 'a', 'a', { a: { id: 'a' } })
		).toBe(false);
		expect(
			hasUnsavedLocalBranch({ a: { id: 'a' } }, { a: { id: 'a' } }, 'a', null, { a: { id: 'a' } })
		).toBe(false);
		// A multi-message history that is fully present on the server is clean,
		// even though older messages are not the currentId.
		expect(
			hasUnsavedLocalBranch(
				{ a: { id: 'a' }, b: { id: 'b' } },
				{ a: { id: 'a' }, b: { id: 'b' } },
				'b',
				'b',
				{ a: { id: 'a' }, b: { id: 'b' } }
			)
		).toBe(false);
	});
});

describe('draft restore generation guard', () => {
	it('restores only a request whose generation and key are still current', async () => {
		let restored = 0;
		const current = { generation: 2, key: 'chat-2' };
		expect(
			await resolveDraftRestore<boolean>({ generation: 1, key: 'chat-1' }, current, () => { restored += 1; return true; }, false)
		).toBe(false);
		expect(
			await resolveDraftRestore<boolean>({ generation: 2, key: 'chat-1' }, current, () => { restored += 1; return true; }, false)
		).toBe(false);
		expect(
			await resolveDraftRestore<boolean>({ generation: 2, key: 'chat-2' }, current, () => { restored += 1; return true; }, false)
		).toBe(true);
		expect(restored).toBe(1);
	});
});

describe('sanitizeHistory repair signal', () => {
	it('reports true only when it actually rewrites history', () => {
		const healthy = {
			messages: {
				a: { id: 'a', role: 'user', parentId: null, childrenIds: [] }
			},
			currentId: 'a'
		};
		expect(sanitizeHistory(healthy)).toBe(false);

		const broken = {
			messages: {
				a: { content: 'orphan' }
			},
			currentId: null
		};
		expect(sanitizeHistory(broken)).toBe(true);
		expect(broken.messages.a).toMatchObject({ id: 'a', role: 'user', parentId: null });
	});
});

describe('continue-chat fork integration points', () => {
	const dir = dirname(fileURLToPath(import.meta.url)); // .../src/lib/utils
	const libDir = join(dir, '..');
	const read = (p: string) => readFileSync(join(libDir, p), 'utf8');
	const chat = read('components/chat/Chat.svelte');
	const layout = read('../routes/+layout.svelte');
	const chatList = read('stores/chatList.ts');
	const chatIndex = read('utils/index.ts');

	it('persists the socket error branch without touching shared/temporary chats', () => {
		const marker = 'failed to persist socket error state';
		const start = chat.indexOf(marker);
		expect(start).toBeGreaterThan(-1);
		const call = chat.slice(Math.max(0, start - 500), start);
		expect(call).toContain('await saveChatHandler(_chatId, history)');
		// saveChatHandler itself enforces the shared/temporary semantics.
		const saveStart = chat.indexOf('const saveChatHandler = async');
		const saveBody = chat.slice(saveStart, saveStart + 700);
		expect(saveBody).toContain('if (isShared) return;');
		expect(saveBody).toContain('if (!$temporaryChatEnabled)');
	});

	it('serialises draft restore through one generation-aware entry', () => {
		expect(chat).toContain('const restoreDraftOnce = (');
		expect(chat).toContain('const generation = ++draftRestoreGeneration');
		expect(chat).toContain('generation <= draftRestoreClaimedGeneration');
		expect(chat).toContain('resolveDraftRestore(');
		expect(chat).toContain('await restoreDraftOnce(storageChatInput, draftKey, generation)');
	});

	it('guards the refresh currentId against local unsaved branches', () => {
		expect(chat).toContain('hasUnsavedLocalBranch(');
		expect(chat).toContain('(follow && !keepLocalBranch)');
	});

	it('resets chat list state on account identity changes', () => {
		expect(chatList).toContain('export const resetChatListState = () => {');
		expect(layout).toContain('refreshChatList, resetChatListState');
		const start = layout.indexOf('const unsubscribeQueueUser = user.subscribe');
		const block = layout.slice(start, start + 600);
		expect(block).toContain('resetChatListState()');
		expect(block).toContain('queueUserId !== value?.id');
	});

	it('persists a repaired history for owner chats and skips read-only ones', () => {
		expect(chatIndex).toContain('const before = JSON.stringify(history);');
		expect(chatIndex).toContain('return JSON.stringify(history) !== before;');
		expect(chat).toContain('const historyRepaired = sanitizeHistory(history);');
		expect(chat).toContain(
			'if (historyRepaired && !isShared && !$temporaryChatEnabled) {'
		);
		expect(chat).toContain('void saveChatHandler(repairedChatId, history)');
	});

	it('the reset helper is reachable from the app layout without leftover scaffolding', () => {
		expect(existsSync(join(libDir, '../routes/+layout.svelte'))).toBe(true);
		expect(layout.match(/resetChatListState\(/g)?.length).toBe(1);
	});
});
