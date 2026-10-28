import { v5 as uuidv5 } from 'uuid';
import type { RecordingJob } from '$lib/apis/recordings';
import sha256 from 'js-sha256';

export const snapshotFingerprint = (title: string, content: string) =>
	sha256(JSON.stringify([title, content]));

// Stable namespace for recording summary idempotency keys (K7).
export const SUMMARY_REQUEST_KEY_NAMESPACE = '8f4d9a21-6c73-4b8e-9a15-2d3e4f5a6b7c';

export function summaryRequestKey(
	jobId: string,
	template: string,
	model: string,
	fingerprint: string
): string {
	return uuidv5([jobId, template, model, fingerprint].join('\n'), SUMMARY_REQUEST_KEY_NAMESPACE);
}

export const formatSyncTime = (timestamp?: number): string => {
	if (!timestamp) return '';
	const date = new Date(timestamp);
	return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
};

export async function mapWithConcurrency<T, R>(
	items: readonly T[],
	limit: number,
	task: (item: T) => Promise<R>
): Promise<R[]> {
	const results = new Array<R>(items.length);
	let cursor = 0;
	const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
		while (cursor < items.length) {
			const index = cursor++;
			results[index] = await task(items[index]);
		}
	});
	await Promise.all(workers);
	return results;
}

export function knowledgeSnapshotState(
	meta: any,
	knowledgeId: string,
	title: string,
	content: string
) {
	if (!knowledgeId || !meta?.recording_knowledge?.[knowledgeId]) return 'new';
	return meta?.recording_knowledge_sync?.[knowledgeId]?.fingerprint ===
		snapshotFingerprint(title, content)
		? 'synced'
		: 'changed';
}

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
