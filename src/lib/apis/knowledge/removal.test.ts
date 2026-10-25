import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('$lib/constants', () => ({ WEBUI_API_BASE_URL: '/api/v1' }));
import { removeFileFromKnowledgeById } from './index';

afterEach(() => vi.unstubAllGlobals());

describe('knowledge document removal', () => {
	it('only sends shared confirmation when explicitly selected', async () => {
		const fetchMock = vi.fn().mockImplementation(async () => new Response('{}', { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);
		await removeFileFromKnowledgeById('synthetic', 'kb', 'file');
		expect(JSON.parse(fetchMock.mock.calls[0][1].body).confirm_shared).toBe(false);
		await removeFileFromKnowledgeById('synthetic', 'kb', 'file', true);
		expect(JSON.parse(fetchMock.mock.calls[1][1].body).confirm_shared).toBe(true);
	});
	it('does not turn a network failure into successful removal', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('synthetic offline')));
		await expect(removeFileFromKnowledgeById('synthetic', 'kb', 'file')).rejects.toThrow(
			'synthetic offline'
		);
	});
	it('preserves structured protection reasons for the confirmation dialog', async () => {
		const detail = {
			reason: 'Protected knowledge content',
			items: [{ reasons: ['shared_confirmation_required'] }]
		};
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail }), { status: 409 }))
		);
		await expect(removeFileFromKnowledgeById('synthetic', 'kb', 'file')).rejects.toEqual(detail);
	});
});
