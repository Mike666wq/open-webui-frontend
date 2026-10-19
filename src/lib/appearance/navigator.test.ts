import { describe, expect, it } from 'vitest';
import {
	branchFingerprint,
	buildNavigatorEntries,
	filterNavigatorEntries,
	isSameNavigatorContext,
	nextNavigatorSelection,
	summarizeQuestion
} from './navigator';

const messages = [
	{ id: 'u1', role: 'user', content: 'How do I debug **port forwarding**?' },
	{ id: 'a1', role: 'assistant', content: 'Use ss first.' },
	{ id: 'u2', role: 'user', content: '```bash\nkubectl get pods\n```\nNow compare targetPort.' },
	{ id: 'a2', role: 'assistant', content: 'Check the service.' }
];

describe('conversation navigator', () => {
	it('indexes only user questions on the loaded branch', () => {
		const entries = buildNavigatorEntries(messages, 'u2');
		expect(entries).toHaveLength(2);
		expect(entries.map((entry) => entry.ordinal)).toEqual([1, 2]);
		expect(entries[0].preview).toBe('How do I debug port forwarding?');
		expect(entries[1].isCurrent).toBe(true);
	});

	it('truncates to 80 user-visible characters and strips markup', () => {
		expect(summarizeQuestion(`# ${'问'.repeat(100)}`)).toHaveLength(81);
		expect(summarizeQuestion('[Link](https://example.com) <b>text</b>')).toBe('Link text');
		expect(summarizeQuestion({ unexpected: true })).toBe('');
	});

	it('filters case-insensitively and supports keyboard selection', () => {
		const entries = buildNavigatorEntries(messages);
		const filtered = filterNavigatorEntries(entries, 'TARGETPORT');
		expect(filtered).toHaveLength(1);
		expect(nextNavigatorSelection(entries, 'u1', 1)).toBe('u2');
		expect(nextNavigatorSelection(entries, 'u1', -1)).toBe('u1');
		expect(nextNavigatorSelection([], 'u1', 1)).toBeNull();
	});

	it('fingerprints the loaded branch and rejects stale context', () => {
		expect(branchFingerprint(messages)).toBe('u1:a1:u2:a2');
		const context = { origin: 'https://a', chatId: 'c', branchId: 'b', generation: 2 };
		expect(isSameNavigatorContext(context, { ...context })).toBe(true);
		expect(isSameNavigatorContext(context, { ...context, generation: 3 })).toBe(false);
	});
});
