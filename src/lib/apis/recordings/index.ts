import { WEBUI_API_BASE_URL } from '$lib/constants';

export type Segment = { text: string; start?: number; end?: number; speaker?: string };
export type RecordingJob = {
	id: string;
	config?: { model_ref?: string; model?: string; provider_connection_id?: string };
	title: string;
	state: string;
	duration: number;
	size_bytes: number;
	source_present: boolean;
	completed_chunks: number;
	total_chunks: number;
	note_id: string;
	error?: string;
	text?: string;
	segments?: Segment[];
	speaker_names: Record<string, string>;
	summary_note_ids: string[];
	capabilities?: { timestamps: boolean; speakers: boolean; cross_chunk_speakers: boolean };
};
export type RecordingConfig = {
	can_delete_tasks?: boolean;
	max_size_mb: number;
	effective_max_size_mb?: number;
	max_duration_seconds: number;
	response_format: string;
	configured: boolean;
	default_model_ref?: string;
	reason?: string;
};
export const recordingsUrl = `${WEBUI_API_BASE_URL}/recordings`;

export class RecordingRequestError extends Error {
	constructor(
		public status: number,
		message: string
	) {
		super(message);
	}
}

export class RecordingNoteError extends Error {
	constructor(
		public status: number,
		message: string
	) {
		super(message);
	}
}

export async function getRecordingNote(token: string, id: string) {
	const response = await fetch(`${WEBUI_API_BASE_URL}/notes/${encodeURIComponent(id)}`, {
		credentials: 'include',
		headers: { Authorization: `Bearer ${token}` }
	});
	if (!response.ok) {
		const body = await response.json().catch(() => ({}));
		throw new RecordingNoteError(
			response.status,
			typeof body.detail === 'string' ? body.detail : `Request failed (${response.status})`
		);
	}
	return response.json();
}

export async function recordingRequest<T>(
	token: string,
	path = '',
	method = 'GET',
	body?: unknown
): Promise<T> {
	const response = await fetch(`${recordingsUrl}${path}`, {
		method,
		credentials: 'include',
		headers: {
			Authorization: `Bearer ${token}`,
			...(body === undefined ? {} : { 'Content-Type': 'application/json' })
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) })
	});
	if (!response.ok) {
		const data = await response.json().catch(() => ({}));
		throw new RecordingRequestError(
			response.status,
			typeof data.detail === 'string' ? data.detail : `Request failed (${response.status})`
		);
	}
	return response.json();
}

export function uploadRecording(
	token: string,
	file: File,
	key: string,
	progress: (percent: number) => void,
	modelRef = ''
): Promise<RecordingJob> {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open('POST', recordingsUrl);
		xhr.withCredentials = true;
		xhr.setRequestHeader('Authorization', `Bearer ${token}`);
		xhr.setRequestHeader('Idempotency-Key', key);
		xhr.upload.onprogress = (event) => {
			if (event.lengthComputable) progress(Math.round((event.loaded / event.total) * 100));
		};
		xhr.onload = () => {
			try {
				const data = JSON.parse(xhr.responseText);
				if (xhr.status >= 200 && xhr.status < 300) resolve(data);
				else
					reject(
						new Error(
							typeof data.detail === 'string' ? data.detail : `Upload failed (${xhr.status})`
						)
					);
			} catch {
				reject(new Error('Invalid upload response'));
			}
		};
		xhr.onerror = () =>
			reject(new Error('Upload connection failed. Retry with the same file to check its task.'));
		const data = new FormData();
		data.append('file', file);
		data.append('language', 'zh');
		if (modelRef) data.append('model_ref', modelRef);
		xhr.send(data);
	});
}
