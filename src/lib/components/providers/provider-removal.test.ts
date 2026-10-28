import { describe, expect, it, vi } from 'vitest';
import { removeAndReconcile } from './provider-removal';
import { ProviderApiError } from '$lib/apis/providers';

describe('connection removal reconciliation', () => {
	it('does not repeat a delete when its response is lost', async () => {
		const remove = vi.fn().mockRejectedValue(new Error('lost'));
		const result = await removeAndReconcile('a', remove, async () => [{ id: 'b' }], true);
		expect(result).toEqual({ state: 'removed', revocationConfirmed: false });
		expect(remove).toHaveBeenCalledTimes(1);
	});
	it('retains a connection when readback finds it', async () => {
		const error = new Error('denied');
		const result = await removeAndReconcile('a', async () => { throw error; }, async () => [{ id: 'a' }], false);
		expect(result).toEqual({ state: 'failed', error });
	});
	it('never interprets an explicit authorization rejection as a deletion', async () => {
		const error = new ProviderApiError('Forbidden');
		const read = vi.fn().mockResolvedValue([]);
		expect(await removeAndReconcile('a', async () => { throw error; }, read, false)).toEqual({ state: 'failed', error });
		expect(read).not.toHaveBeenCalled();
	});
	it('reports uncertainty when readback also fails', async () => {
		const error = new Error('lost');
		const result = await removeAndReconcile('a', async () => { throw error; }, async () => { throw new Error('offline'); }, false);
		expect(result).toEqual({ state: 'uncertain', error });
	});
	it('reports confirmed OAuth revocation from a successful response', async () => {
		const read = vi.fn();
		expect(await removeAndReconcile('a', async () => ({ revocation_confirmed: true }), read, true))
			.toEqual({ state: 'removed', revocationConfirmed: true });
		expect(read).not.toHaveBeenCalled();
	});
});
