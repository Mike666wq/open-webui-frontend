import { describe, expect, it } from 'vitest';

import { createFilePreviewSession } from './index';

describe('createFilePreviewSession', () => {
	it('aborts the old request and rejects stale results when the preview changes', () => {
		const session = createFilePreviewSession();
		const first = session.begin();
		expect(session.isCurrent(first)).toBe(true);

		const second = session.begin();
		expect(first.signal.aborted).toBe(true);
		expect(session.isCurrent(first)).toBe(false);
		expect(session.isCurrent(second)).toBe(true);
	});

	it('aborts the active request and clears its authority on close', () => {
		const session = createFilePreviewSession();
		const request = session.begin();

		session.cancel();

		expect(request.signal.aborted).toBe(true);
		expect(session.isCurrent(request)).toBe(false);
	});
});
