import { describe, expect, it } from 'vitest';
import { imageInputStatus, visionCapability } from './model-capabilities';

describe('provider vision capability', () => {
	const provider = (vision?: boolean) => ({
		id: 'provider:connection:visual',
		info: { meta: { capabilities: vision === undefined ? {} : { vision } } }
	});

	it('uses the vendor declaration when there is no explicit override', () => {
		expect(visionCapability(provider(true))).toBe(true);
	});
	it('lets explicit false override a vendor true result from /api/models', () => {
		expect(visionCapability(provider(false))).toBe(false);
	});
	it('allows selecting an image while the provider capability is unknown', () => {
		expect(visionCapability(provider())).toBeUndefined();
		expect(imageInputStatus(['provider:connection:visual'], [provider()])).toBe('unknown');
	});
	it('recognizes a provider behind a legacy model alias', () => {
		expect(visionCapability({ id: 'legacy', provider_model_id: 'provider:connection:model' })).toBeUndefined();
	});
	it('does not impose the new submission guard on workspace models', () => {
		expect(imageInputStatus(['workspace-model'], [{ id: 'workspace-model', info: { meta: { capabilities: { vision: false } } } }])).toBe('supported');
	});
	it('keeps workspace model default true', () => {
		expect(visionCapability({ id: 'workspace-model' })).toBe(true);
	});
	it('returns explicit false when multiple selected models disagree', () => {
		expect(imageInputStatus(['provider:connection:visual', 'workspace-model'], [
			provider(false), { id: 'workspace-model' }
		])).toBe('unsupported');
	});
});
