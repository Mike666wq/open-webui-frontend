import { describe, expect, it } from 'vitest';
import {
	candidatePool,
	formatVerificationSummary,
	isAnyPurposeTested,
	purposesOf,
	purposesOfCandidate,
	supportsPurpose,
	verificationLabel
} from './provider-models';

describe('provider model helpers', () => {
	it('lists the purposes of a curated model without exposing adapters', () => {
		expect(
			purposesOf({ upstream_id: 'a', uses: { chat: 'openai-chat', image: 'openai-image' } })
		).toEqual(['chat', 'image']);
		expect(purposesOf({ upstream_id: 'a' })).toEqual([]);
		expect(purposesOf(undefined)).toEqual([]);
	});

	it('derives the purpose of a candidate from its capabilities', () => {
		expect(purposesOfCandidate({ upstream_id: 'a', capabilities: ['TG'] })).toEqual(['chat']);
		expect(purposesOfCandidate({ upstream_id: 'a', uses: { speech: 'openai-speech' } })).toEqual([
			'speech'
		]);
		expect(purposesOfCandidate({ upstream_id: 'a' })).toEqual([]);
	});

	it('keeps only the candidates that are not in the whitelist yet', () => {
		const pool = candidatePool(
			[{ upstream_id: 'a' }, { upstream_id: 'b' }, { upstream_id: 'c' }],
			[{ upstream_id: 'b' }]
		);
		expect(pool.map((candidate) => candidate.upstream_id)).toEqual(['a', 'c']);
	});

	it('reports the verification state per purpose', () => {
		expect(verificationLabel({ chat: { status: 'passed' } }, 'chat')).toBe('passed');
		expect(verificationLabel({ chat: { status: 'failed' } }, 'image')).toBe('untested');
		expect(verificationLabel(undefined, 'chat')).toBe('untested');
		expect(isAnyPurposeTested({ chat: { status: 'passed' } })).toBe(true);
		expect(isAnyPurposeTested({ chat: { status: 'failed' } })).toBe(false);
	});

	it('formats verification summary with latency and TTFT', () => {
		expect(formatVerificationSummary(undefined, 'chat')).toEqual({
			status: 'untested',
			label: 'untested'
		});
		expect(formatVerificationSummary({ chat: { status: 'failed' } }, 'chat')).toEqual({
			status: 'failed',
			label: 'failed'
		});
		expect(
			formatVerificationSummary({ chat: { status: 'passed', elapsed_ms: 120 } }, 'chat')
		).toEqual({
			status: 'passed',
			label: '120ms',
			latency: 120,
			ttft: undefined,
			usage: undefined
		});
		expect(
			formatVerificationSummary(
				{
					chat: {
						status: 'passed',
						elapsed_ms: 250,
						timings: { first_output_ms: 80, upstream_total_ms: 250 }
					}
				},
				'chat'
			)
		).toEqual({
			status: 'passed',
			label: 'TTFT 80ms · 250ms',
			latency: 250,
			ttft: 80,
			usage: undefined
		});
	});

	it('only offers the media purposes on the OpenAI compatible protocols', () => {
		expect(supportsPurpose('openai-compatible', 'image')).toBe(true);
		expect(supportsPurpose('openai-responses', 'chat')).toBe(true);
		expect(supportsPurpose('anthropic-messages', 'chat')).toBe(true);
		expect(supportsPurpose('anthropic-messages', 'image')).toBe(false);
		expect(supportsPurpose('local', 'chat')).toBe(true);
		expect(supportsPurpose('local', 'speech')).toBe(false);
	});
});
