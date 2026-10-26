import { describe, expect, it } from 'vitest';

import {
	AUXILIARY_PURPOSES,
	auxiliaryPurposeField,
	resolveAuxiliaryModel,
	unconfiguredAuxiliaryPurposes
} from './auxiliary-models';

describe('auxiliary model selection', () => {
	it('lets a purpose override the shared default', () => {
		const config = {
			TASK_MODEL: 'aux-local',
			TASK_MODEL_EXTERNAL: 'aux-remote',
			TASK_MODEL_TITLE: 'title-local',
			TASK_MODEL_TITLE_EXTERNAL: 'title-remote'
		};

		expect(resolveAuxiliaryModel(config, 'title', 'local')).toBe('title-local');
		expect(resolveAuxiliaryModel(config, 'title', 'external')).toBe('title-remote');
		expect(resolveAuxiliaryModel(config, 'tags', 'local')).toBe('aux-local');
		expect(resolveAuxiliaryModel(config, 'tags', 'external')).toBe('aux-remote');
	});

	it('keeps inheriting the shared default when a purpose is not set', () => {
		const config = { TASK_MODEL: 'aux-local', TASK_MODEL_EXTERNAL: 'aux-remote' };

		for (const purpose of AUXILIARY_PURPOSES) {
			expect(resolveAuxiliaryModel(config, purpose.key, 'local')).toBe('aux-local');
			expect(resolveAuxiliaryModel(config, purpose.key, 'external')).toBe('aux-remote');
		}
	});

	it('selects a different model per purpose', () => {
		const config = {
			TASK_MODEL: 'aux-local',
			TASK_MODEL_EXTERNAL: 'aux-remote',
			TASK_MODEL_TITLE: 'title-local',
			TASK_MODEL_TAGS: 'tags-local'
		};

		expect(resolveAuxiliaryModel(config, 'title', 'local')).toBe('title-local');
		expect(resolveAuxiliaryModel(config, 'tags', 'local')).toBe('tags-local');
		expect(resolveAuxiliaryModel(config, 'followup', 'local')).toBe('aux-local');
		expect(resolveAuxiliaryModel(config, 'query', 'local')).toBe('aux-local');
	});

	it('never falls back to a chat model', () => {
		const config = {};

		for (const purpose of AUXILIARY_PURPOSES) {
			expect(resolveAuxiliaryModel(config, purpose.key, 'local')).toBe('');
			expect(resolveAuxiliaryModel(config, purpose.key, 'external')).toBe('');
		}
		expect(unconfiguredAuxiliaryPurposes(config)).toEqual(['title', 'tags', 'followup', 'query']);
	});

	it('reports only the purposes that still have no model', () => {
		const config = { TASK_MODEL: 'aux-local', TASK_MODEL_TAGS: 'tags-local' };

		expect(unconfiguredAuxiliaryPurposes(config)).toEqual([]);
	});

	it('maps every purpose to its own configuration fields', () => {
		const fields = AUXILIARY_PURPOSES.map((purpose) => [
			auxiliaryPurposeField(purpose.key, 'local'),
			auxiliaryPurposeField(purpose.key, 'external')
		]);

		expect(fields).toEqual([
			['TASK_MODEL_TITLE', 'TASK_MODEL_TITLE_EXTERNAL'],
			['TASK_MODEL_TAGS', 'TASK_MODEL_TAGS_EXTERNAL'],
			['TASK_MODEL_FOLLOWUP', 'TASK_MODEL_FOLLOWUP_EXTERNAL'],
			['TASK_MODEL_QUERY', 'TASK_MODEL_QUERY_EXTERNAL']
		]);
	});
});
