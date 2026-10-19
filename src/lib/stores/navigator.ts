import { derived, writable } from 'svelte/store';
import {
	buildNavigatorEntries,
	isSameNavigatorContext,
	type NavigatorEntry
} from '$lib/appearance/navigator';

export type NavigatorSession = {
	origin: string;
	chatId: string;
	branchId: string;
	generation: number;
	entries: NavigatorEntry[];
};

const EMPTY_SESSION: NavigatorSession = {
	origin: '',
	chatId: '',
	branchId: '',
	generation: 0,
	entries: []
};

export const navigatorSession = writable<NavigatorSession>(EMPTY_SESSION);
export const navigatorOpen = writable(false);
export const navigatorEntryCount = derived(
	navigatorSession,
	($session) => $session.entries.length
);

export function publishNavigatorEntries(input: {
	origin: string;
	chatId: string;
	branchId: string;
	messages: unknown[];
	currentMessageId?: string | null;
}): void {
	navigatorSession.update((current) => ({
		origin: input.origin,
		chatId: input.chatId,
		branchId: input.branchId,
		generation:
			current.origin === input.origin &&
			current.chatId === input.chatId &&
			current.branchId === input.branchId
				? current.generation + 1
				: 1,
		entries: buildNavigatorEntries(input.messages, input.currentMessageId)
	}));
}

export function clearNavigator(): void {
	navigatorSession.update((current) => ({
		...EMPTY_SESSION,
		generation: current.generation + 1
	}));
	navigatorOpen.set(false);
}

export function setNavigatorCurrent(
	input: {
		origin: string;
		chatId: string;
		branchId: string;
		generation: number;
	},
	messageId: string
): boolean {
	let accepted = false;
	navigatorSession.update((current) => {
		if (!isSameNavigatorContext(current, input)) return current;
		if (!current.entries.some((entry) => entry.id === messageId)) return current;
		accepted = true;
		return {
			...current,
			entries: current.entries.map((entry) => ({
				...entry,
				isCurrent: entry.id === messageId
			}))
		};
	});
	return accepted;
}

export function openNavigator(): void {
	navigatorOpen.set(true);
}

export function closeNavigator(): void {
	navigatorOpen.set(false);
}

export function toggleNavigator(): void {
	navigatorOpen.update((open) => !open);
}
