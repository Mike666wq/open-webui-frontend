import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('$lib/constants', () => ({ WEBUI_API_BASE_URL: '/api/v1' }));
import {
	getRecordingNote,
	RecordingNoteError,
	recordingRequest,
	RecordingRequestError
} from './index';

afterEach(() => vi.unstubAllGlobals());

describe('recording lookup errors', () => {
	it('keeps a missing note distinct from a transient server failure', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValue(new Response(JSON.stringify({ detail: 'missing' }), { status: 404 }))
		);
		await expect(getRecordingNote('synthetic-token', 'note')).rejects.toMatchObject({
			status: 404
		});
		await expect(getRecordingNote('synthetic-token', 'note')).rejects.toBeInstanceOf(
			RecordingNoteError
		);
	});
	it('retains the status for a removed task without parsing message text', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValue(
					new Response(JSON.stringify({ detail: 'Recording not found' }), { status: 404 })
				)
		);
		await expect(recordingRequest('synthetic-token', '/task')).rejects.toBeInstanceOf(
			RecordingRequestError
		);
	});
});
