import { describe, it, expect } from 'vitest';
import type { RecordingJob } from '$lib/apis/recordings';
import { timeLabel, transcriptText } from './utils';

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
