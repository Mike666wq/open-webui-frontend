import { afterEach, describe, expect, it, vi } from 'vitest';

import { isNativeNotifyAvailable, postNativeNotification } from './native-notify';

declare global {
	// eslint-disable-next-line no-var
	var __openWebUiNotify: { post?: (payload: string) => void } | undefined;
}

afterEach(() => {
	delete (globalThis as Record<string, unknown>).__openWebUiNotify;
	vi.restoreAllMocks();
});

describe('native notify bridge', () => {
	it('is unavailable in a plain browser', () => {
		expect(isNativeNotifyAvailable()).toBe(false);
		expect(
			postNativeNotification({
				type: 'member-active',
				userId: 'u1',
				name: 'Ke Zhou'
			})
		).toBe(false);
	});

	it('posts serialized payloads to the bridge', () => {
		const post = vi.fn();
		(globalThis as Record<string, unknown>).__openWebUiNotify = { post };
		expect(isNativeNotifyAvailable()).toBe(true);

		const ok = postNativeNotification({
			type: 'message',
			channelId: 'c1',
			messageId: 'm1',
			title: 'bbben',
			text: 'hello   there',
			senderId: 'u2',
			isDm: true
		});
		expect(ok).toBe(true);
		expect(post).toHaveBeenCalledOnce();
		const payload = JSON.parse(post.mock.calls[0][0]);
		expect(payload).toMatchObject({
			type: 'message',
			channelId: 'c1',
			messageId: 'm1',
			title: 'bbben',
			text: 'hello there',
			senderId: 'u2',
			isDm: true
		});
	});

	it('clamps over-long text', () => {
		const post = vi.fn();
		(globalThis as Record<string, unknown>).__openWebUiNotify = { post };
		postNativeNotification({
			type: 'message',
			channelId: 'c1',
			title: 't'.repeat(200),
			text: 'x'.repeat(500),
			isDm: false
		});
		const payload = JSON.parse(post.mock.calls[0][0]);
		expect(payload.title.length).toBeLessThanOrEqual(80);
		expect(payload.text.length).toBeLessThanOrEqual(160);
	});

	it('swallows bridge errors instead of breaking the page', () => {
		(globalThis as Record<string, unknown>).__openWebUiNotify = {
			post: () => {
				throw new Error('native gone');
			}
		};
		expect(postNativeNotification({ type: 'member-active', userId: 'u1', name: 'n' })).toBe(
			false
		);
	});
});
