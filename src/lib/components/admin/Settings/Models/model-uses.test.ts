import { describe, expect, it } from 'vitest';
import { connectionAccess, groupConnectionModels, purposesForModel } from './model-uses';

describe('provider models by purpose', () => {
	it('groups all four purposes, counts each connection and leaves unassigned models uncategorized', () => {
		const groups = groupConnectionModels([
			{
				id: 'one', name: 'One', models: [
					{ upstream_id: 'multi', uses: { chat: 'chat', transcription: 'asr' } },
					{ upstream_id: 'voice', uses: { speech: 'tts' }, enabled: false },
					{ upstream_id: 'image', uses: { image: 'image' } },
					{ upstream_id: 'unknown', uses: {} }
				]
			},
			{ id: 'two', name: 'Two', models: [{ upstream_id: 'chat', uses: { chat: 'chat' } }] }
		]);
		expect(groups.map(({ purpose, connections }) => [purpose, connections.map(({ models }) => models.length)])).toEqual([
			['chat', [1, 1]], ['transcription', [1]], ['speech', [1]], ['image', [1]], ['uncategorized', [1]]
		]);
		expect(purposesForModel({ upstream_id: 'unknown' })).toEqual(['uncategorized']);
	});

	it('reads connection access only, never workspace model grants', () => {
		expect(connectionAccess({ id: 'one', name: 'One', visibility: 'private' })).toBe('private');
		expect(connectionAccess({ id: 'one', name: 'One', visibility: 'shared', access_control: [] })).toBe('shared');
		expect(connectionAccess({ id: 'one', name: 'One', visibility: 'shared', access_control: [{ principal_type: 'user', principal_id: '*', permission: 'read' }] })).toBe('public');
	});
});
