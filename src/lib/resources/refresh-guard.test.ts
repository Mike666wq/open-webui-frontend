import { describe, expect, it } from 'vitest';
import { createRequestGuard } from './refresh-guard';

describe('resources request guard', () => {
	it('rejects a response from an account that was switched away from', () => {
		const guard = createRequestGuard();
		const old = guard.begin('user-a');

		expect(guard.isCurrent(old, false, 'user-a')).toBe(true);
		expect(guard.isCurrent(old, false, 'user-b')).toBe(false);
	});

	it('invalidates in-flight requests only when refresh begins', () => {
		const guard = createRequestGuard();
		const first = guard.begin('user-a');
		const retry = guard.issue();
		expect(retry.generation).toBe(first.generation);
		expect(guard.isCurrent(retry, false, 'user-a')).toBe(true);

		const second = guard.begin('user-a');
		expect(second.generation).toBe(first.generation + 1);
		expect(guard.isCurrent(first, false, 'user-a')).toBe(false);
		expect(guard.isCurrent(retry, false, 'user-a')).toBe(false);
	});
});
