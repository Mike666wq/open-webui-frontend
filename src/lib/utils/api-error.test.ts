import { describe, expect, it } from 'vitest';
import { describeApiError } from './api-error';

/**
 * The failure that started this: deleting a chat that was still streaming a
 * reply answered 409 with a structured detail, and the interface printed
 * `[object Object]` — a message with no information in it at all.
 */
const protectedChatDetail = {
	reason: 'protected_resource',
	items: [
		{
			id: '8a4b0971-d9bf-416a-9d0c-86a08169e39f',
			type: 'chat',
			title: '请用 CSS 和 JavaScript 写一个网站吸顶导航的代码示例。',
			reasons: ['active_generation'],
			allowed: false
		}
	]
};

describe('a protected resource explains itself', () => {
	it('names the item and the reason instead of [object Object]', () => {
		const text = describeApiError(protectedChatDetail);
		expect(text).not.toContain('object Object');
		expect(text).toContain('吸顶导航');
		expect(text).toContain('生成');
	});

	it('covers every reason the recycle policy emits', () => {
		const reasons = [
			'active_generation',
			'pinned',
			'shared_confirmation_required',
			'active_upload_or_processing',
			'referenced',
			'draft_attachment',
			'already_recycled',
			'other_owner'
		];
		for (const reason of reasons) {
			const text = describeApiError({
				reason: 'protected_resource',
				items: [{ title: 't', reasons: [reason] }]
			});
			// Every reason must become words, never the raw snake_case token.
			expect(text).not.toContain(reason);
		}
	});

	it('summarises several protected items', () => {
		const text = describeApiError({
			reason: 'protected_resource',
			items: [
				{ title: 'A', reasons: ['pinned'] },
				{ title: 'B', reasons: ['active_generation'] },
				{ title: 'C', reasons: ['referenced'] },
				{ title: 'D', reasons: ['other_owner'] }
			]
		});
		expect(text).toContain('4 个项目');
		expect(text).toContain('等');
	});

	it('falls back to a pointer when no item carries a reason', () => {
		const text = describeApiError({ reason: 'protected_resource', items: [{}] });
		expect(text).toContain('资源与存储');
	});

	it('joins several reasons on one item', () => {
		const text = describeApiError({
			reason: 'protected_resource',
			items: [{ title: 'X', reasons: ['pinned', 'shared_confirmation_required'] }]
		});
		expect(text).toContain('置顶');
		expect(text).toContain('分享');
	});
});

describe('plain failures still read as before', () => {
	it('passes a string detail through', () => {
		expect(describeApiError('Use Resources & Storage to recycle this content')).toBe(
			'Use Resources & Storage to recycle this content'
		);
	});

	it('passes an Error message through', () => {
		expect(describeApiError(new Error('network down'))).toBe('network down');
	});

	it('reads {detail: "..."}', () => {
		expect(describeApiError({ detail: '报错文本' })).toBe('报错文本');
	});

	it('reads {detail: {message: "..."}}', () => {
		expect(describeApiError({ detail: { message: '内层消息' } })).toBe('内层消息');
	});

	it('reads FastAPI validation arrays', () => {
		expect(
			describeApiError({ detail: [{ loc: ['body'], msg: 'field required' }, { msg: 'bad type' }] })
		).toBe('field required；bad type');
	});
});

describe('never prints a useless placeholder', () => {
	it('uses the fallback for empty input', () => {
		expect(describeApiError(null)).toBe('操作失败，请稍后再试');
		expect(describeApiError('')).toBe('操作失败，请稍后再试');
		expect(describeApiError({})).toBe('操作失败，请稍后再试');
	});

	it('does not leak "[object Object]" for any shape tried here', () => {
		const shapes: unknown[] = [
			{ a: 1 },
			{ error: { nested: true } },
			[{ msg: 'x' }],
			new Error(''),
			{ detail: undefined }
		];
		for (const shape of shapes) {
			expect(describeApiError(shape)).not.toContain('object Object');
		}
	});
});
