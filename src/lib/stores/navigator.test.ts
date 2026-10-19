import { get } from 'svelte/store';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	clearNavigator,
	navigatorSession,
	publishNavigatorEntries,
	setNavigatorCurrent
} from './navigator';

describe('conversation navigator store', () => {
	beforeEach(() => clearNavigator());

	it('publishes the loaded branch and ignores stale selection results', () => {
		publishNavigatorEntries({
			origin: 'https://one.example',
			chatId: 'chat-a',
			branchId: 'u1:a1:u2:a2',
			messages: [
				{ id: 'u1', role: 'user', content: 'First' },
				{ id: 'a1', role: 'assistant', content: 'Answer' },
				{ id: 'u2', role: 'user', content: 'Second' }
			]
		});
		const oldContext = get(navigatorSession);
		expect(oldContext.entries.map((entry) => entry.id)).toEqual(['u1', 'u2']);

		publishNavigatorEntries({
			origin: 'https://two.example',
			chatId: 'chat-b',
			branchId: 'u9:a9',
			messages: [{ id: 'u9', role: 'user', content: 'New service' }]
		});
		const afterSwitch = get(navigatorSession);
		expect(setNavigatorCurrent(oldContext, 'u2')).toBe(false);
		expect(get(navigatorSession)).toEqual(afterSwitch);
		expect(setNavigatorCurrent(afterSwitch, 'u9')).toBe(true);
		expect(get(navigatorSession).entries[0].isCurrent).toBe(true);
	});

	it('clears entries and advances the generation when the conversation is removed', () => {
		publishNavigatorEntries({
			origin: 'https://one.example',
			chatId: 'chat-a',
			branchId: 'u1',
			messages: [{ id: 'u1', role: 'user', content: 'Hello' }]
		});
		const pending = get(navigatorSession);
		clearNavigator();
		expect(get(navigatorSession).entries).toEqual([]);
		expect(get(navigatorSession).generation).toBe(pending.generation + 1);
	});
});
