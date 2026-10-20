import { describe, expect, it } from 'vitest';

import { detectCameOnline } from './presence-alerts';
import type { DirectoryUser } from './types';

const member = (id: string, is_active: boolean | null): DirectoryUser => ({
	id,
	name: id,
	is_active
});

describe('detectCameOnline', () => {
	it('does not alert on the first baseline load', () => {
		const previous = new Map<string, boolean>();
		const users = [member('a', true), member('b', false)];
		expect(detectCameOnline(previous, users, false)).toEqual([]);
	});

	it('alerts only when a member goes from away to active', () => {
		const previous = new Map([
			['a', false],
			['b', false],
			['c', true]
		]);
		const users = [member('a', true), member('b', false), member('c', true)];
		const cameOnline = detectCameOnline(previous, users, true);
		expect(cameOnline.map((m) => m.id)).toEqual(['a']);
	});

	it('ignores members whose state was never observed', () => {
		const previous = new Map<string, boolean>();
		const users = [member('new', true)];
		expect(detectCameOnline(previous, users, true)).toEqual([]);
	});

	it('ignores unknown (null) states', () => {
		const previous = new Map([['a', false]]);
		const users = [member('a', null)];
		expect(detectCameOnline(previous, users, true)).toEqual([]);
	});
});
