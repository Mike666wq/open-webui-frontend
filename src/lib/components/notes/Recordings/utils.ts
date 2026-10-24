import type { RecordingJob } from '$lib/apis/recordings';

export const timeLabel = (seconds: number) => {
	const s = Math.max(0, Math.floor(seconds));
	return `${Math.floor(s / 3600) ? `${Math.floor(s / 3600)}:` : ''}${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export function hasCompleteSegments(job: RecordingJob): boolean {
	return (
		!!job.segments?.length &&
		job.segments.map((s) => s.text.replace(/\s/g, '')).join('') ===
			(job.text ?? '').replace(/\s/g, '')
	);
}

export function transcriptText(job: RecordingJob, timestamps: boolean, speakers: boolean): string {
	if ((!timestamps && !speakers) || !job.segments?.length) return job.text ?? '';
	// Some services return detail for only part of the transcript. Never export a
	// partial segment list as if it were the complete original.
	const segments = job.segments;
	if (
		segments.map((s) => s.text.replace(/\s/g, '')).join('') !== (job.text ?? '').replace(/\s/g, '')
	)
		return job.text ?? '';
	return segments
		.map((s) =>
			[
				timestamps && s.start !== undefined ? `[${timeLabel(s.start)}]` : '',
				speakers && s.speaker ? `${job.speaker_names[s.speaker] || s.speaker}:` : '',
				s.text
			]
				.filter(Boolean)
				.join(' ')
		)
		.join('\n\n');
}
