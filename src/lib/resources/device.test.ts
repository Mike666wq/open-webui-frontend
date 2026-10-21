import { describe, expect, it } from 'vitest';
import { managedCacheNames, managedDraftKeys } from './device';
import { summarizeTask, type Task } from './api';

describe('managed device data', () => {
	it('never selects credentials, appearance or another application cache as rebuildable data', () => {
		expect(managedCacheNames(['owui-rebuildable:chunks', 'workbox-precache', 'other-app'])).toEqual(['owui-rebuildable:chunks']);
		const keys = ['token', 'chat-input-123', 'chat-input', 'owui-appearance:v3:http://local', 'chat-inputx'];
		expect(managedDraftKeys({ length: keys.length, key: (i) => keys[i] })).toEqual(['chat-input-123', 'chat-input']);
	});
	it('does not turn an HTTP success into a false operation success', () => {
		expect(summarizeTask({ state: 'failed', results: [{ success: false, reason: 'referenced' }] } as Task)).toEqual({
			success: 0, failed: 1, running: false
		});
	});
});
