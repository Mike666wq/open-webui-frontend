import { describe, it, expect, vi } from 'vitest';
import type { RecordingJob } from '$lib/apis/recordings';
import {
	timeLabel,
	transcriptText,
	snapshotFingerprint,
	knowledgeSnapshotState,
	summaryRequestKey,
	formatSyncTime,
	mapWithConcurrency
} from './utils';

const job: RecordingJob = {
	id: 'recording',
	title: '课堂',
	state: 'completed',
	duration: 3002,
	size_bytes: 1,
	source_present: true,
	completed_chunks: 6,
	total_chunks: 6,
	note_id: 'note',
	summary_note_ids: [],
	text: '老师讲课。\n\n同学提问。',
	speaker_names: { 'part-1:0': '老师' },
	segments: [
		{ text: '老师讲课。', start: 0, end: 2, speaker: 'part-1:0' },
		{ text: '同学提问。', start: 3000, end: 3002, speaker: 'part-6:0' }
	]
};

describe('recording documents', () => {
	it('tracks each knowledge snapshot across edits and reloads', () => {
		const meta = {
			recording_knowledge: { kb: 'file' },
			recording_knowledge_sync: { kb: { fingerprint: snapshotFingerprint('title', 'text') } }
		};
		expect(knowledgeSnapshotState(meta, 'kb', 'title', 'text')).toBe('synced');
		expect(knowledgeSnapshotState(meta, 'kb', 'title', 'edited')).toBe('changed');
		expect(knowledgeSnapshotState(meta, 'kb', 'renamed', 'text')).toBe('changed');
		expect(knowledgeSnapshotState(meta, 'other-kb', 'title', 'text')).toBe('new');
		expect(
			knowledgeSnapshotState({ recording_knowledge: { kb: 'legacy-file' } }, 'kb', 'title', 'text')
		).toBe('changed');
	});
	it('formats class and longer meeting timestamps', () => {
		expect(timeLabel(3000)).toBe('50:00');
		expect(timeLabel(7201)).toBe('2:00:01');
	});
	it('exports complete original text without markers', () => {
		expect(transcriptText(job, false, false)).toBe(job.text);
	});
	it('exports timestamps and renamed speakers without conflating chunk speakers', () => {
		expect(transcriptText(job, true, true)).toBe(
			'[00:00] 老师: 老师讲课。\n\n[50:00] part-6:0: 同学提问。'
		);
	});
	it('allows either marker independently', () => {
		expect(transcriptText(job, true, false)).not.toContain('老师:');
		expect(transcriptText(job, false, true)).not.toContain('[00:00]');
	});
	it('falls back to the full text if segment detail is incomplete', () => {
		expect(transcriptText({ ...job, segments: job.segments!.slice(0, 1) }, true, true)).toBe(
			job.text
		);
	});
	it('does not invent detail for text-only ASR', () => {
		expect(transcriptText({ ...job, segments: [] }, true, true)).toBe(job.text);
	});
});

describe('summary request keys (K7)', () => {
	const fingerprint = snapshotFingerprint('transcript', 'content');
	it('derives a stable UUID from job, template, model and source fingerprint', () => {
		const key = summaryRequestKey('job-1', 'class', 'model-a', fingerprint);
		expect(key).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
		);
		expect(summaryRequestKey('job-1', 'class', 'model-a', fingerprint)).toBe(key);
	});
	it('changes when any semantic input changes', () => {
		const base = summaryRequestKey('job-1', 'class', 'model-a', fingerprint);
		expect(summaryRequestKey('job-2', 'class', 'model-a', fingerprint)).not.toBe(base);
		expect(summaryRequestKey('job-1', 'meeting', 'model-a', fingerprint)).not.toBe(base);
		expect(summaryRequestKey('job-1', 'class', 'model-b', fingerprint)).not.toBe(base);
		expect(summaryRequestKey('job-1', 'class', 'model-a', snapshotFingerprint('t', 'other'))).not.toBe(
			base
		);
	});
});

describe('formatSyncTime (K8)', () => {
	it('returns a non-empty string for a valid timestamp', () => {
		const label = formatSyncTime(1735689600000);
		expect(typeof label).toBe('string');
		expect(label.length).toBeGreaterThan(0);
	});
	it('returns an empty string for missing or invalid timestamps', () => {
		expect(formatSyncTime(undefined)).toBe('');
		expect(formatSyncTime(0)).toBe('');
		expect(formatSyncTime(Number.NaN)).toBe('');
	});
});

describe('mapWithConcurrency (K5)', () => {
	it('maps all items preserving order', async () => {
		const result = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => n * 10);
		expect(result).toEqual([10, 20, 30, 40, 50]);
	});
	it('never runs more than the configured number of tasks at once', async () => {
		let running = 0;
		let peak = 0;
		await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
			running += 1;
			peak = Math.max(peak, running);
			await new Promise((resolve) => setTimeout(resolve, 5));
			running -= 1;
			return n;
		});
		expect(peak).toBeLessThanOrEqual(3);
	});
	it('propagates task failures', async () => {
		await expect(
			mapWithConcurrency(['a', 'b'], 2, async (item) => {
				if (item === 'b') throw new Error('boom');
				return item;
			})
		).rejects.toThrow('boom');
	});
});
