<script lang="ts">
	import ProviderModelSelect from '$lib/components/common/ProviderModelSelect.svelte';
	import { onMount, getContext } from 'svelte';
	import { v4 as uuidv4 } from 'uuid';
	import { toast } from 'svelte-sonner';
	import { beforeNavigate } from '$app/navigation';
	import { models, user, showSidebar, config as backendConfig } from '$lib/stores';
	import { getNoteById, updateNoteById } from '$lib/apis/notes';
	import {
		getKnowledgeBases,
		addFileToKnowledgeById,
		updateFileFromKnowledgeById
	} from '$lib/apis/knowledge';
	import { uploadFile, updateFileDataContentById, renameFileById } from '$lib/apis/files';
	import {
		recordingRequest,
		getRecordingNote,
		RecordingNoteError,
		RecordingRequestError,
		uploadRecording,
		recordingsUrl,
		type RecordingJob,
		type RecordingConfig
	} from '$lib/apis/recordings';
	import {
		transcriptText,
		timeLabel,
		hasCompleteSegments,
		snapshotFingerprint,
		knowledgeSnapshotState
	} from './Recordings/utils';
	const i18n = getContext<typeof import('$lib/i18n').default>('i18n');
	let selectedModelRef = '';
	let retryModelRef = '';
	let jobs: RecordingJob[] = [];
	let selected: RecordingJob | null = null;
	let configuration: RecordingConfig | null = null;
	let selectedFile: File | null = null;
	let fileInput: HTMLInputElement;
	let uploadKey = '';
	let progress = 0;
	let uploading = false;
	let busy = false;
	let error = '';
	let pollingError = '';
	let audioError = false;
	let audioReload = 0;
	let note: any = null;
	let documentTitle = '';
	let savedTitle = '';
	let working = '';
	let actionErrors: Record<string, string> = {};
	let knowledgeNotice = '';
	let content = '';
	let savedContent = '';
	let documentId = '';
	let audio: HTMLAudioElement;
	let model = '';
	let template = 'class';
	let summaryKey = '';
	let timestamps = true;
	let speakers = true;
	let speakerNames: Record<string, string> = {};
	let knowledge: any[] = [];
	let knowledgeId = '';
	let more = true;
	let deleteConfirm = false;
	let deleteTaskConfirm = false;
	let missingNotes = new Set<string>();
	let removedTaskNotice = '';
	let taskFilter = 'all';
	let removedTaskIds = new Set<string>();
	$: visibleJobs = jobs.filter(
		(job) =>
			taskFilter === 'all' || (taskFilter === 'audio' ? job.source_present : !job.source_present)
	);
	$: dirty = content !== savedContent || documentTitle !== savedTitle;
	$: snapshotState = knowledgeSnapshotState(note?.meta, knowledgeId, documentTitle, content);
	$: speakerIds = [
		...new Set((selected?.segments ?? []).map((s) => s.speaker).filter((s): s is string => !!s))
	];
	$: documents = selected ? [selected.note_id, ...selected.summary_note_ids] : [];
	const stateNames: Record<string, string> = {
		queued: 'Queued',
		preparing: 'Preparing audio',
		transcribing: 'Transcribing',
		saving: 'Saving document',
		completed: 'Completed',
		failed: 'Failed',
		interrupted: 'Interrupted',
		cancelled: 'Cancelled'
	};
	const active = (job: RecordingJob) =>
		['queued', 'preparing', 'transcribing', 'saving'].includes(job.state);
	beforeNavigate(({ cancel }) => {
		if (
			(dirty || uploading) &&
			!window.confirm(
				$i18n.t('Leave this page? Unsaved changes or the current upload may be lost.')
			)
		)
			cancel();
	});
	async function execute(action: () => Promise<void>, operation = '') {
		if (busy) return;
		busy = true;
		working = operation;
		if (operation) actionErrors = { ...actionErrors, [operation]: '' };
		error = '';
		try {
			await action();
		} catch (e) {
			const message = String(e instanceof Error ? e.message : e);
			if (operation) actionErrors = { ...actionErrors, [operation]: message };
			else error = message;
			toast.error(message);
		} finally {
			busy = false;
			working = '';
		}
	}
	async function loadDocument(id: string) {
		if (dirty && !window.confirm($i18n.t('Discard unsaved changes?'))) {
			documentId = note?.id ?? '';
			return;
		}
		if (!id) return;
		let loaded;
		try {
			loaded = await getRecordingNote(localStorage.token, id);
		} catch (e) {
			if (!(e instanceof RecordingNoteError) || ![403, 404].includes(e.status)) throw e;
			missingNotes = new Set([...missingNotes, id]);
			note = null;
			documentId = id;
			content = savedContent = documentTitle = savedTitle = '';
			return;
		}
		missingNotes.delete(id);
		missingNotes = new Set(missingNotes);
		note = loaded;
		documentId = id;
		content = savedContent = loaded?.data?.content?.md ?? '';
		documentTitle = savedTitle = loaded.title;
		knowledgeNotice = '';
		actionErrors = { knowledgeList: actionErrors.knowledgeList ?? '' };
	}
	async function selectJob(job: RecordingJob) {
		if (dirty && !window.confirm($i18n.t('Discard unsaved changes?'))) return;
		content = savedContent;
		documentTitle = savedTitle;
		try {
			selected = await recordingRequest<RecordingJob>(localStorage.token, `/${job.id}`);
			removedTaskNotice = '';
		} catch (e) {
			if (!(e instanceof RecordingRequestError) || e.status !== 404) throw e;
			removedTaskIds = new Set([...removedTaskIds, job.id]);
			jobs = jobs.filter((item) => item.id !== job.id);
			selected = null;
			note = null;
			content = savedContent = documentTitle = savedTitle = '';
			removedTaskNotice = $i18n.t(
				'This task record was removed or is unavailable. Existing notes and knowledge documents are managed separately.'
			);
			return;
		}
		retryModelRef = selected.config?.model_ref ?? '';
		actionErrors = { knowledgeList: actionErrors.knowledgeList ?? '' };
		knowledgeNotice = '';
		speakerNames = { ...selected.speaker_names };
		summaryKey = '';
		deleteConfirm = false;
		deleteTaskConfirm = false;
		audioError = false;
		note = null;
		documentId = '';
		content = savedContent = '';
		documentTitle = savedTitle = '';
		if (selected.state === 'completed') await loadDocument(selected.note_id);
	}
	async function refresh() {
		const rows = await recordingRequest<RecordingJob[]>(localStorage.token);
		jobs = [...rows, ...jobs.slice(50)].filter((job) => !removedTaskIds.has(job.id));
		more = rows.length === 50;
		if (selected) {
			const id = selected.id;
			let result: RecordingJob;
			try {
				result = await recordingRequest<RecordingJob>(localStorage.token, `/${id}`);
			} catch (e) {
				if (!(e instanceof RecordingRequestError) || e.status !== 404) throw e;
				removedTaskIds = new Set([...removedTaskIds, id]);
				jobs = jobs.filter((job) => job.id !== id);
				if (selected?.id === id) {
					selected = null;
					// Keep an unsaved document in memory; task deletion does not delete notes.
					removedTaskNotice = $i18n.t(
						'This task record was removed or is unavailable. Existing notes and knowledge documents are managed separately.'
					);
				}
				pollingError = '';
				return;
			}
			if (selected?.id !== id) return;
			selected = result;
			if (!note && result.state === 'completed' && !missingNotes.has(documentId || result.note_id))
				await loadDocument(documentId || result.note_id);
		}
		pollingError = '';
	}
	async function loadKnowledge() {
		const bases = await getKnowledgeBases(localStorage.token);
		knowledge = (Array.isArray(bases) ? bases : (bases.items ?? [])).filter(
			(k: any) => k.write_access !== false && k.type !== 'external'
		);
		actionErrors = { ...actionErrors, knowledgeList: '' };
	}
	onMount(() => {
		let disposed = false;
		let timer: ReturnType<typeof setTimeout>;
		const poll = async () => {
			try {
				await refresh();
			} catch (e) {
				pollingError = String(e instanceof Error ? e.message : e);
			}
			if (!disposed) timer = setTimeout(poll, 4000);
		};
		execute(async () => {
			configuration = await recordingRequest<RecordingConfig>(localStorage.token, '/config');
			selectedModelRef = configuration.default_model_ref ?? '';
			await loadKnowledge().catch((e) => {
				actionErrors = {
					...actionErrors,
					knowledgeList: String(e instanceof Error ? e.message : e)
				};
			});
			try {
				await refresh();
			} catch (e) {
				pollingError = String(e instanceof Error ? e.message : e);
			}
			const id = new URLSearchParams(location.search).get('id');
			if (id) await selectJob({ id } as RecordingJob);
		}).finally(() => {
			if (!disposed) timer = setTimeout(poll, 4000);
		});
		const unload = (e: BeforeUnloadEvent) => {
			if (dirty || uploading) {
				e.preventDefault();
				e.returnValue = '';
			}
		};
		window.addEventListener('beforeunload', unload);
		return () => {
			disposed = true;
			clearTimeout(timer);
			window.removeEventListener('beforeunload', unload);
		};
	});
	async function upload() {
		if (!selectedFile || uploading) return;
		uploading = true;
		progress = 0;
		error = '';
		try {
			const job = await uploadRecording(
				localStorage.token,
				selectedFile,
				uploadKey,
				(value) => (progress = value),
				selectedModelRef
			);
			selectedFile = null;
			if (fileInput) fileInput.value = '';
			jobs = [job, ...jobs.filter((item) => item.id !== job.id)];
			try {
				await selectJob(job);
				await refresh();
			} catch (e) {
				// Upload acceptance is independent from subsequent status reads.
				pollingError = String(e instanceof Error ? e.message : e);
			}
		} catch (e) {
			error = String(e instanceof Error ? e.message : e);
		} finally {
			uploading = false;
		}
	}
	async function save() {
		if (!note) return;
		if (!documentTitle.trim()) throw new Error($i18n.t('Document title is required'));
		note = await updateNoteById(localStorage.token, note.id, {
			title: documentTitle.trim(),
			data: { ...note.data, content: { md: content } },
			meta: note.meta
		});
		savedContent = content;
		documentTitle = savedTitle = note.title;
		toast.success($i18n.t('Saved'));
	}
	async function removeTask() {
		if (!selected) return;
		if (dirty) await save();
		const id = selected.id;
		await recordingRequest(localStorage.token, `/${id}`, 'DELETE');
		removedTaskIds = new Set([...removedTaskIds, id]);
		selected = null;
		note = null;
		content = savedContent = documentTitle = savedTitle = documentId = '';
		deleteTaskConfirm = false;
		jobs = jobs.filter((job) => job.id !== id);
		toast.success($i18n.t('Task record deleted. Notes and knowledge documents were kept.'));
		await refresh();
	}
	function download(text: string, name: string, extension: string) {
		const url = URL.createObjectURL(
			new Blob([text], {
				type: extension === 'md' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8'
			})
		);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${name.replace(/[\\/:*?"<>|]/g, '_')}.${extension}`;
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
	async function syncKnowledge() {
		if (!note || !knowledgeId) return;
		knowledgeNotice = '';
		if (dirty) await save();
		const fresh = await getNoteById(localStorage.token, note.id);
		const mappings = fresh.meta?.recording_knowledge ?? {};
		let fileId = mappings[knowledgeId];
		if (fileId) {
			await renameFileById(localStorage.token, fileId, `${fresh.title}.md`);
			await updateFileDataContentById(localStorage.token, fileId, content);
			await updateFileFromKnowledgeById(localStorage.token, knowledgeId, fileId);
		} else {
			const file = await uploadFile(
				localStorage.token,
				new File([content], `${fresh.title}.md`, { type: 'text/markdown' }),
				null,
				true,
				true
			);
			if (file.error) throw new Error(file.error);
			await addFileToKnowledgeById(localStorage.token, knowledgeId, file.id);
			fileId = file.id;
		}
		note = await updateNoteById(localStorage.token, fresh.id, {
			title: fresh.title,
			data: fresh.data,
			meta: {
				...fresh.meta,
				recording_knowledge: { ...mappings, [knowledgeId]: fileId },
				recording_knowledge_sync: {
					...fresh.meta?.recording_knowledge_sync,
					[knowledgeId]: {
						fingerprint: snapshotFingerprint(fresh.title, content),
						updated_at: Date.now()
					}
				}
			}
		});
		knowledgeNotice = $i18n.t('Saved {{document}} to {{knowledge}}', {
			document: fresh.title,
			knowledge: knowledge.find((base) => base.id === knowledgeId)?.name ?? knowledgeId
		});
		toast.success($i18n.t('Knowledge snapshot updated'));
	}
</script>

<svelte:head><title>{$i18n.t('Recording to document')} / Open WebUI</title></svelte:head>
<div
	class="recordings-page w-full min-w-0 h-full overflow-y-auto {$showSidebar
		? 'md:max-w-[calc(100%-var(--sidebar-width))]'
		: ''}"
>
	<div class="recordings-surface mx-auto min-h-full max-w-6xl px-4 py-6 md:px-8 md:py-8 space-y-6">
		<header class="recording-header flex items-center justify-between gap-3">
			<div>
				<a class="text-sm underline" href="/notes">← {$i18n.t('Notes')}</a>
				<h1 class="text-2xl md:text-3xl font-semibold tracking-tight mt-3">
					{$i18n.t('Recording to document')}
				</h1>
			</div>
		</header>
		<p class="text-sm text-gray-500">
			{$i18n.t(
				'Upload a recording, keep the transcript, then optionally create class notes or meeting minutes.'
			)}
		</p>
		{#if error}<div role="alert" class="rounded-xl bg-red-500/10 p-3 text-sm break-words">
				{error}
				<button class="ml-3 underline" on:click={() => (error = '')}>{$i18n.t('Dismiss')}</button>
			</div>{/if}
		{#if removedTaskNotice}<p role="status" class="rounded-xl bg-amber-500/10 p-3 text-sm">
				{removedTaskNotice}
			</p>{/if}
		{#if pollingError}<div
				data-testid="recording-poll-warning"
				role="status"
				class="rounded-xl bg-amber-500/10 p-3 text-sm break-words"
			>
				{$i18n.t(
					'Task status could not be refreshed. Background transcription may still be running; this page will retry automatically.'
				)}
				<details><summary>{$i18n.t('Details')}</summary>{pollingError}</details>
			</div>{/if}
		{#if configuration && !configuration.configured}<div
				role="status"
				class="rounded-xl bg-amber-500/10 p-3 text-sm"
			>
				{$i18n.t('Configure cloud speech-to-text in Admin Settings → Audio before uploading.')}
				<p class="mt-1">{configuration.reason}</p>
			</div>{/if}
		<section
			class="upload-panel rounded-2xl border border-gray-200 dark:border-gray-700 p-5 md:p-6 space-y-4"
			aria-label={$i18n.t('Upload recording')}
		>
			<div class="section-heading">
				<span class="step-number">01</span>
				<div>
					<h2 class="font-semibold">{$i18n.t('Upload recording')}</h2>
					<p class="section-caption">
						{$i18n.t('Choose an audio file and transcription model to create a document.')}
					</p>
				</div>
			</div>
			{#if $backendConfig?.features?.enable_provider_model_capabilities}<p
					id="recording-model-label"
					class="text-sm"
				>
					{$i18n.t('Transcription model')}
				</p>
				<ProviderModelSelect
					purpose="transcription"
					labelledBy="recording-model-label"
					bind:value={selectedModelRef}
					disabled={uploading}
					on:change={() => (uploadKey = uuidv4())}
				/>{/if}
			<label
				for="recording-file"
				class="flex min-w-0 cursor-pointer flex-wrap items-center gap-3 rounded-xl border border-dashed border-gray-400 bg-white/70 p-4 focus-within:ring-2 focus-within:ring-blue-500 dark:border-gray-600 dark:bg-gray-900/70"
			>
				<span
					class="flex min-h-11 shrink-0 items-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
				>
					{$i18n.t(selectedFile ? 'Change recording file' : 'Choose recording file')}
				</span>
				<span class="min-w-0 flex-1 text-sm">
					<span class="block break-all"
						>{selectedFile?.name ?? $i18n.t('No recording selected')}</span
					>
					{#if selectedFile}<span class="text-xs text-gray-500"
							>{(selectedFile.size / 1024 / 1024).toFixed(1)} MB</span
						>{:else}<span class="text-xs text-gray-500">M4A · MP3 · WAV · WebM · OGG · FLAC</span
						>{/if}
				</span>
				<input
					id="recording-file"
					bind:this={fileInput}
					aria-label={$i18n.t('Choose recording file')}
					type="file"
					accept="audio/*,.m4a,.mp3,.wav,.webm,.ogg,.flac,.aac,.amr"
					disabled={uploading}
					on:change={(e) => {
						selectedFile = e.currentTarget.files?.[0] ?? null;
						uploadKey = uuidv4();
					}}
					class="sr-only"
				/>
			</label>
			{#if selectedFile}<button
					type="button"
					class="text-xs underline"
					disabled={uploading}
					on:click={() => {
						selectedFile = null;
						fileInput.value = '';
						uploadKey = uuidv4();
					}}>{$i18n.t('Clear selected recording')}</button
				>{/if}
			<p class="text-xs text-gray-500">
				{$i18n.t('Ordinary Mandarin · original audio is retained until you delete it.')}
				{#if configuration}{configuration.effective_max_size_mb ?? configuration.max_size_mb} MB · {Math.floor(
						configuration.max_duration_seconds / 60
					)}
					{$i18n.t('minutes')} · {$i18n.t('Existing upload limits also apply.')}{/if}
			</p>
			<button
				class="primary"
				disabled={!selectedFile ||
					uploading ||
					busy ||
					(!configuration?.configured && !selectedModelRef)}
				on:click={upload}
				>{uploading
					? `${progress}% · ${$i18n.t('Uploading')}`
					: $i18n.t('Start transcription')}</button
			>
			{#if uploading}<progress class="w-full" max="100" value={progress}></progress>{/if}
			<p class="text-xs text-gray-500">
				{$i18n.t(
					'After submission, transcription continues when you leave this page. Uploading requires keeping this page open.'
				)}
			</p>
		</section>
		{#if configuration && $user?.role === 'admin'}
			<details class="recording-settings text-sm">
				<summary
					><span
						><span class="block font-medium">{$i18n.t('Recording settings')}</span><span
							class="section-caption"
							>{$i18n.t(
								'Upload limits and transcription output format · administrators only'
							)}</span
						></span
					><span class="settings-chevron" aria-hidden="true">⌄</span></summary
				>
				<div class="flex flex-wrap items-end gap-3 p-3">
					<label
						>{$i18n.t('Maximum size (MB)')}<input
							class="field w-28"
							type="number"
							min="1"
							max="2048"
							bind:value={configuration.max_size_mb}
						/></label
					>
					<label
						>{$i18n.t('Maximum duration (seconds)')}<input
							class="field w-32"
							type="number"
							min="60"
							max="43200"
							bind:value={configuration.max_duration_seconds}
						/></label
					>
					<label
						>{$i18n.t('ASR response format')}<select
							class="field"
							bind:value={configuration.response_format}
							><option value="json">JSON</option><option value="verbose_json">Verbose JSON</option
							><option value="diarized_json">Diarized JSON</option></select
						></label
					>
					<button
						class="secondary"
						disabled={busy}
						on:click={() =>
							execute(async () => {
								await recordingRequest(localStorage.token, '/config', 'POST', {
									max_size_mb: configuration!.max_size_mb,
									max_duration_seconds: configuration!.max_duration_seconds,
									response_format: configuration!.response_format
								});
								configuration = await recordingRequest(localStorage.token, '/config');
								toast.success($i18n.t('Saved'));
							})}>{$i18n.t('Save')}</button
					>
					<p class="w-full text-xs text-gray-500">
						{$i18n.t(
							'Keep JSON unless your ASR documents support for another format. A model name alone does not provide timestamps or speakers.'
						)}
					</p>
				</div>
			</details>
		{/if}
		<div class="recording-workspace grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
			<section aria-label={$i18n.t('Transcription tasks')} class="min-w-0 space-y-2">
				<div class="flex items-center justify-between gap-2">
					<h2 class="font-semibold">{$i18n.t('Transcription tasks')}</h2>
					<span class="task-count">{jobs.length}{more ? '+' : ''}</span>
				</div>
				<p class="section-caption">
					{$i18n.t(
						'Deleting audio keeps its task and documents. Delete the task separately to remove it from this list.'
					)}
				</p>
				<label class="block"
					><span class="sr-only">{$i18n.t('Filter recording tasks')}</span><select
						class="field w-full"
						aria-label={$i18n.t('Filter recording tasks')}
						bind:value={taskFilter}
						><option value="all">{$i18n.t('All tasks')}</option><option value="audio"
							>{$i18n.t('Audio available')}</option
						><option value="removed">{$i18n.t('Audio deleted')}</option></select
					></label
				>
				{#each visibleJobs as job (job.id)}<button
						class="task w-full text-left rounded-xl border p-4"
						aria-pressed={selected?.id === job.id}
						class:chosen={selected?.id === job.id}
						disabled={busy}
						on:click={() => execute(() => selectJob(job))}
						><span class="block truncate font-medium">{job.title}</span><span
							class="text-xs text-gray-500"
							>{$i18n.t(stateNames[job.state] ?? job.state)} · {timeLabel(job.duration)} · {job.completed_chunks}/{job.total_chunks}</span
						>
						<span class="audio-badge" class:audio-removed={!job.source_present}
							>{$i18n.t(job.source_present ? 'Audio available' : 'Audio deleted')}</span
						>
					</button>{/each}
				{#if !visibleJobs.length}<p class="empty-tasks text-sm">
						{$i18n.t(jobs.length ? 'No tasks match this filter.' : 'No recordings yet.')}
					</p>{/if}
				{#if more && jobs.length}<button
						class="secondary"
						disabled={busy}
						on:click={() =>
							execute(async () => {
								const rows = await recordingRequest<RecordingJob[]>(
									localStorage.token,
									`?offset=${jobs.length}`
								);
								jobs = [...jobs, ...rows];
								more = rows.length === 50;
							})}>{$i18n.t('Load more')}</button
					>{/if}
			</section>
			{#if selected}
				<section class="document-panel min-w-0 space-y-4" aria-label={$i18n.t('Recording details')}>
					<h2 class="text-lg font-semibold break-words">{selected.title}</h2>
					<p role="status" class="text-sm">
						{$i18n.t(stateNames[selected.state] ?? selected.state)} · {$i18n.t(
							'Completed segments'
						)}: {selected.completed_chunks}/{selected.total_chunks}
					</p>
					{#if selected.error || selected.state === 'interrupted'}<p
							role="alert"
							class="text-sm text-amber-700 dark:text-amber-300"
						>
							{selected.error ||
								$i18n.t(
									'The service was interrupted. Saved segments are retained; the last request may have been charged. Retry manually.'
								)}
						</p>{/if}
					<div class="flex flex-wrap gap-2">
						{#if active(selected)}<button
								class="secondary"
								disabled={busy}
								on:click={() =>
									execute(async () => {
										selected = await recordingRequest(
											localStorage.token,
											`/${selected!.id}/cancel`,
											'POST'
										);
										await refresh();
									})}>{$i18n.t('Cancel')}</button
							>{/if}
						{#if ['failed', 'interrupted', 'cancelled'].includes(selected.state) && selected.source_present}<button
								class="secondary"
								disabled={busy}
								on:click={() =>
									execute(async () => {
										if (
											!window.confirm(
												$i18n.t(
													'Retry unfinished segments? The previous request may already have been charged. A changed ASR configuration restarts the transcript.'
												)
											)
										)
											return;
										selected = await recordingRequest(
											localStorage.token,
											`/${selected!.id}/retry`,
											'POST'
										);
										await refresh();
									})}>{$i18n.t('Retry unfinished segments')}</button
							>{/if}
					</div>
					{#if ['failed', 'interrupted', 'cancelled'].includes(selected.state) && selected.source_present}
						<details class="rounded border p-2 text-sm">
							<summary>{$i18n.t('Restart with a selected model')}</summary>
							<ProviderModelSelect
								purpose="transcription"
								bind:value={retryModelRef}
								disabled={busy}
							/>
							<button
								class="secondary mt-2"
								disabled={busy || !retryModelRef}
								on:click={() =>
									execute(async () => {
										if (
											!confirm(
												$i18n.t(
													'Restart the entire recording with this model? Saved segments will be replaced and new charges may apply.'
												)
											)
										)
											return;
										selected = await recordingRequest(
											localStorage.token,
											`/${selected!.id}/retry`,
											'POST',
											{ model_ref: retryModelRef, restart: true }
										);
										await refresh();
									})}>{$i18n.t('Restart full transcription')}</button
							>
						</details>
					{/if}
					{#if selected.source_present}
						<p class="text-xs">{$i18n.t('Original recording')} · {timeLabel(selected.duration)}</p>
						{#key `${selected.id}:${audioReload}`}
							<audio
								class="w-full"
								bind:this={audio}
								src={`${recordingsUrl}/${selected.id}/audio`}
								controls
								preload="metadata"
								aria-label={$i18n.t('Original recording')}
								on:error={() => (audioError = true)}
								on:loadedmetadata={() => (audioError = false)}
							></audio>
						{/key}
						{#if audioError}<p class="text-xs text-amber-700 dark:text-amber-300">
								{$i18n.t(
									'Audio playback failed. This does not affect transcription or saved documents.'
								)}
								<button
									class="underline ml-2"
									on:click={() => {
										audioError = false;
										audioReload += 1;
									}}>{$i18n.t('Reload audio')}</button
								>
							</p>{/if}
						{#if !active(selected)}<button
								class="text-xs underline"
								disabled={busy}
								on:click={() => (deleteConfirm = !deleteConfirm)}
								>{$i18n.t('Delete original audio')}</button
							>{/if}
						{#if deleteConfirm}<div class="rounded-xl border border-red-400 p-3 text-sm">
								<p>
									{$i18n.t(
										'Delete the audio permanently? Documents remain, but playback and audio retries will be unavailable.'
									)}
								</p>
								<button
									class="secondary mt-2"
									disabled={busy}
									on:click={() =>
										execute(async () => {
											await recordingRequest(
												localStorage.token,
												`/${selected!.id}/audio`,
												'DELETE'
											);
											await refresh();
											deleteConfirm = false;
										})}>{$i18n.t('Confirm deletion')}</button
								>
							</div>{/if}
					{:else}<p class="audio-deletion-notice text-sm">
							{$i18n.t('Original audio deleted. Text documents remain available.')}
						</p>{/if}
					{#if !selected.source_present && !active(selected) && configuration?.can_delete_tasks}
						<button
							class="secondary text-red-600 dark:text-red-400"
							disabled={busy}
							data-testid="remove-recording-task"
							on:click={() => (deleteTaskConfirm = !deleteTaskConfirm)}
							>{$i18n.t('Delete task record')}</button
						>
						{#if deleteTaskConfirm}<div class="rounded-xl border border-red-400 p-3 text-sm">
								<p>
									{$i18n.t(
										'Permanently delete this task and its ASR snapshot? Existing notes and knowledge documents will be kept. This cannot be undone.'
									)}
								</p>
								<button
									class="secondary mt-2"
									disabled={busy}
									data-testid="confirm-remove-recording-task"
									on:click={() => execute(removeTask, 'removeTask')}
									>{$i18n.t('Confirm deletion')}</button
								>
								<button
									class="secondary ml-2"
									disabled={busy}
									on:click={() => (deleteTaskConfirm = false)}>{$i18n.t('Cancel')}</button
								>
							</div>{/if}
						{#if actionErrors.removeTask}<p role="alert" class="text-sm text-red-600">
								{actionErrors.removeTask}
							</p>{/if}
					{/if}
					{#if selected.state === 'completed'}
						{#if !selected.capabilities?.timestamps || !selected.capabilities?.speakers}<p
								class="text-xs text-gray-500"
							>
								{$i18n.t(
									'Missing timestamps or speaker labels were not returned by this ASR. The full text is still available.'
								)}
							</p>{/if}
						{#if speakerIds.length}<details>
								<summary class="text-sm">{$i18n.t('Speaker names')}</summary>
								<p class="text-xs text-gray-500 my-2">
									{$i18n.t(
										'Speaker labels belong to individual segments; identities are not automatically matched across segments.'
									)}
								</p>
								<div class="space-y-2">
									{#each speakerIds as speaker}<label class="block text-xs"
											>{speaker}<input
												class="field"
												maxlength="100"
												bind:value={speakerNames[speaker]}
												placeholder={speaker}
											/></label
										>{/each}<button
										class="secondary"
										disabled={busy}
										on:click={() =>
											execute(async () => {
												selected = await recordingRequest(
													localStorage.token,
													`/${selected!.id}/speakers`,
													'PATCH',
													{ names: speakerNames }
												);
											})}>{$i18n.t('Save speaker names')}</button
									>
								</div>
							</details>{/if}
						<details>
							<summary class="text-sm">{$i18n.t('Original transcript and timestamps')}</summary>
							<div class="mt-2 max-h-72 overflow-y-auto space-y-2 text-sm">
								{#each selected.segments ?? [] as segment}<div class="flex gap-2 items-start">
										{#if segment.start !== undefined}<button
												class="shrink-0 underline text-xs"
												disabled={!selected.source_present}
												on:click={() => {
													if (audio) {
														audio.currentTime = segment.start!;
														audio.play().catch(() => {});
													}
												}}>{timeLabel(segment.start)}</button
											>{/if}
										<p class="whitespace-pre-wrap break-words min-w-0">
											{segment.speaker
												? `${selected.speaker_names[segment.speaker] || segment.speaker}: `
												: ''}{segment.text}
										</p>
									</div>{/each}
								{#if !hasCompleteSegments(selected)}<p class="whitespace-pre-wrap">
										{selected.text}
									</p>{/if}
							</div>
							<div class="flex flex-wrap gap-3 my-3 text-xs">
								<label
									><input type="checkbox" bind:checked={timestamps} />
									{$i18n.t('Timestamps')}</label
								><label
									><input type="checkbox" bind:checked={speakers} /> {$i18n.t('Speakers')}</label
								>{#each ['txt', 'md'] as ext}<button
										class="secondary"
										on:click={() =>
											download(
												transcriptText(selected!, timestamps, speakers),
												`${selected!.title}-transcript`,
												ext
											)}>{$i18n.t('Export original')} {ext.toUpperCase()}</button
									>{/each}
							</div>
						</details>
						{#if missingNotes.has(documentId || selected.note_id)}
							<div
								role="status"
								class="rounded-xl border border-amber-400 p-3 text-sm"
								data-testid="recording-note-missing"
							>
								{$i18n.t(
									'The linked note was deleted or is unavailable. Transcription is complete and its original snapshot is still available below. Restore the note from Resources & Storage if needed.'
								)}
								<button
									class="underline ml-2"
									disabled={busy}
									on:click={() => execute(() => loadDocument(documentId || selected!.note_id))}
									>{$i18n.t('Check note again')}</button
								>
							</div>
						{:else}<div
								class="rounded-xl border border-green-500/30 bg-green-500/5 p-3 text-sm"
								role="status"
							>
								{$i18n.t(
									'Transcription is complete. The transcript was saved automatically as a private note.'
								)}
								<a class="ml-2 underline" href={`/notes/${selected.note_id}`}
									>{$i18n.t('Open transcript note')}</a
								>
							</div>{/if}
						<h3 class="font-medium">1 · {$i18n.t('Edit and save notes')}</h3>
						<label class="block text-sm"
							>{$i18n.t('Document')}<select
								class="field w-full"
								disabled={busy}
								bind:value={documentId}
								on:change={() => execute(() => loadDocument(documentId))}
								>{#each documents as id, index}<option value={id}
										>{index === 0
											? $i18n.t('Transcript')
											: `${$i18n.t('Organized notes')} ${index}`}</option
									>{/each}</select
							></label
						>
						{#if note}
							<label class="block text-sm"
								>{$i18n.t('Document title')}<input
									class="field w-full"
									bind:value={documentTitle}
									disabled={busy}
									maxlength="255"
								/></label
							>
							<p class="text-xs" role="status">
								{$i18n.t(dirty ? 'Unsaved changes' : 'Saved to notes')}
							</p>
							{#if actionErrors.save}<p role="alert" class="text-sm text-red-600">
									{actionErrors.save}
								</p>{/if}
							<textarea
								aria-label={$i18n.t('Document content')}
								class="field w-full min-h-80 font-mono text-sm"
								bind:value={content}
								disabled={busy}
							></textarea>
							<div class="flex flex-wrap items-center gap-2">
								<button
									class="primary"
									disabled={busy || !dirty}
									on:click={() => execute(save, 'save')}
									>{$i18n.t(working === 'save' ? 'Saving document' : 'Save')}</button
								><a class="secondary" href={`/notes/${note.id}`}>{$i18n.t('Open in notes')}</a
								>{#each ['txt', 'md'] as ext}<button
										class="secondary"
										on:click={() => download(content, note.title, ext)}
										>{$i18n.t('Export document')} {ext.toUpperCase()}</button
									>{/each}
							</div>{/if}
						<div class="border-t dark:border-gray-800 pt-3 space-y-2">
							<h3 class="font-medium text-sm">2 · {$i18n.t('Create organized notes')}</h3>
							<p class="text-xs text-gray-500">
								{$i18n.t(
									'Uses the transcript note as source and saves a separate new note. The original stays available.'
								)}
							</p>
							{#if actionErrors.summary}<p role="alert" class="text-sm text-red-600">
									{actionErrors.summary}
								</p>{/if}
							<div class="flex flex-wrap gap-2">
								<select
									class="field min-w-0 max-w-full"
									aria-label={$i18n.t('Text model')}
									bind:value={model}
									disabled={busy}
									on:change={() => (summaryKey = '')}
									><option value="">{$i18n.t('Select a model')}</option
									>{#each $models.filter((m) => !m.info?.meta?.hidden) as m}<option value={m.id}
											>{m.name || m.id}</option
										>{/each}</select
								><select
									class="field"
									aria-label={$i18n.t('Template')}
									bind:value={template}
									disabled={busy}
									on:change={() => (summaryKey = '')}
									><option value="class">{$i18n.t('Class notes')}</option><option value="meeting"
										>{$i18n.t('Meeting minutes')}</option
									></select
								><button
									class="secondary"
									disabled={busy || !model || missingNotes.has(selected.note_id)}
									on:click={() =>
										execute(async () => {
											if (dirty) await save();
											summaryKey ||= uuidv4();
											const result = await recordingRequest<{ note_id: string }>(
												localStorage.token,
												`/${selected!.id}/summary`,
												'POST',
												{ model, template, request_key: summaryKey }
											);
											summaryKey = '';
											await refresh();
											await loadDocument(result.note_id);
										}, 'summary')}
									>{working === 'summary'
										? $i18n.t('Generating and saving note')
										: $i18n.t('Generate')}</button
								>
							</div>
							<p class="text-xs text-gray-500">
								{$i18n.t(
									'Uses the saved transcript note. The selected text model may charge separately. Original transcription is never overwritten.'
								)}
							</p>
						</div>
						{#if note}<div class="border-t dark:border-gray-800 pt-3 space-y-2">
								<h3 class="font-medium text-sm">
									3 · {$i18n.t('Add or update knowledge snapshot')}
								</h3>
								<p class="text-sm">
									{$i18n.t('Selected document')}: <strong>{documentTitle}</strong>
								</p>
								{#if actionErrors.knowledge}<p role="alert" class="text-sm text-red-600">
										{actionErrors.knowledge}<br />{$i18n.t(
											'Your note is preserved. Check the target knowledge base before retrying an uncertain request.'
										)}
									</p>{/if}
								{#if knowledgeNotice}<p
										role="status"
										class="text-sm text-green-700 dark:text-green-300"
									>
										{knowledgeNotice}
									</p>{/if}
								{#if actionErrors.knowledgeList}<p role="alert" class="text-sm text-red-600">
										{$i18n.t('Could not load knowledge bases')}: {actionErrors.knowledgeList}
									</p>
									<button
										class="secondary"
										disabled={busy}
										on:click={() => execute(loadKnowledge, 'knowledgeList')}
										>{$i18n.t('Retry')}</button
									>
								{:else if !knowledge.length}<p class="text-xs">
										{$i18n.t(
											'No writable knowledge bases are available. Create one in Workspace → Knowledge, then reload this page.'
										)}
									</p>{/if}
								<div class="flex flex-wrap gap-2">
									<select
										class="field max-w-full"
										aria-label={$i18n.t('Knowledge base')}
										bind:value={knowledgeId}
										disabled={busy}
										on:change={() => (knowledgeNotice = '')}
										><option value="">{$i18n.t('Select a knowledge base')}</option
										>{#each knowledge as base}<option value={base.id}>{base.name}</option
											>{/each}</select
									><button
										class="secondary"
										disabled={busy || !knowledgeId || snapshotState === 'synced'}
										on:click={() => execute(syncKnowledge, 'knowledge')}
										data-testid="knowledge-sync"
										>{$i18n.t(
											working === 'knowledge'
												? 'Saving knowledge snapshot'
												: snapshotState === 'synced'
													? 'Knowledge snapshot is current'
													: snapshotState === 'changed'
														? 'Update knowledge snapshot'
														: 'Save current document to knowledge'
										)}</button
									>
								</div>
								{#if knowledgeId && snapshotState === 'changed'}<p
										class="text-xs text-amber-700 dark:text-amber-300"
									>
										{$i18n.t(
											'The knowledge copy differs from this document. Update it manually to publish your edits.'
										)}
									</p>{/if}
								{#if knowledgeNotice}<a
										class="text-sm underline"
										href={`/workspace/knowledge/${knowledgeId}`}>{$i18n.t('Open knowledge base')}</a
									>{/if}
								<p class="text-xs text-gray-500">
									{$i18n.t(
										'Saves the selected document as a snapshot. Click again to update it after editing; audio is not shared.'
									)}
								</p>
							</div>{/if}
					{/if}
				</section>
			{:else}<p class="text-sm text-gray-500">
					{$i18n.t('Select a recording to see its progress and documents.')}
				</p>{/if}
		</div>
	</div>
</div>

<style>
	.recording-header a {
		color: var(--recording-muted);
		text-decoration: none;
	}
	.recording-header a:hover {
		text-decoration: underline;
	}
	.recordings-page {
		--recording-muted: #526174;
		--recording-border: #dbe1e8;
		--recording-card: #fff;
		--recording-soft: #f4f7fb;
		color: #172334;
	}
	:global(.dark) .recordings-page {
		--recording-muted: #b6c1ce;
		--recording-border: #384454;
		--recording-card: #1c2939;
		--recording-soft: #223145;
		color: #edf2f7;
	}
	.recordings-page :global(.text-gray-500) {
		color: var(--recording-muted);
	}
	.section-heading {
		display: flex;
		align-items: center;
		gap: 0.85rem;
	}
	.step-number {
		display: grid;
		place-items: center;
		flex-shrink: 0;
		width: 2.5rem;
		height: 2.5rem;
		border-radius: 0.85rem;
		background: #2563eb;
		color: white;
		font-size: 0.8rem;
		font-weight: 600;
	}
	.section-caption {
		display: block;
		margin-top: 0.25rem;
		color: var(--recording-muted);
		font-size: 0.78rem;
		line-height: 1.6;
	}
	.upload-panel,
	.document-panel {
		background: var(--recording-card);
		border: 1px solid var(--recording-border);
		box-shadow: 0 3px 16px rgb(0 0 0 / 0.025);
	}
	.document-panel {
		padding: 1.5rem;
		border-radius: 1rem;
	}
	.recording-settings {
		border: 1px solid var(--recording-border);
		border-radius: 1rem;
		background: var(--recording-card);
	}
	.recording-settings > summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem 1.25rem;
		cursor: pointer;
		list-style: none;
	}
	.recording-settings > summary::-webkit-details-marker {
		display: none;
	}
	.recording-settings[open] > summary {
		border-bottom: 1px solid var(--recording-border);
	}
	.settings-chevron {
		font-size: 1.4rem;
		transition: transform 0.15s;
	}
	.recording-settings[open] .settings-chevron {
		transform: rotate(180deg);
	}
	.recording-settings > div {
		padding: 1.25rem;
	}
	.task-count {
		padding: 0.15rem 0.55rem;
		border-radius: 0.5rem;
		background: var(--recording-soft);
		color: var(--recording-muted);
		font-size: 0.75rem;
	}
	.audio-badge {
		display: table;
		margin-top: 0.6rem;
		padding: 0.15rem 0.5rem;
		border-radius: 0.4rem;
		font-size: 0.7rem;
		color: var(--recording-muted);
		background: var(--recording-soft);
	}
	.audio-removed {
		border: 1px dashed var(--recording-border);
	}
	.audio-deletion-notice {
		padding: 0.8rem 1rem;
		border-radius: 0.75rem;
		background: var(--recording-soft);
		color: var(--recording-muted);
	}
	.empty-tasks {
		padding: 1.25rem;
		border: 1px dashed var(--recording-border);
		border-radius: 0.75rem;
		color: var(--recording-muted);
	}
	@media (max-width: 640px) {
		.document-panel {
			padding: 1rem;
		}
	}

	.recordings-surface {
		background-color: rgb(var(--mist-surface-rgb, 255 255 255) / 0.96);
	}
	.recordings-page :global(button:focus-visible),
	.recordings-page :global(summary:focus-visible),
	.recordings-page :global(select:focus-visible),
	.recordings-page :global(textarea:focus-visible),
	.recordings-page :global(input:focus-visible) {
		outline: 2px solid #3b82f6;
		outline-offset: 3px;
	}
	.document-panel :global(h3) {
		padding-top: 0.35rem;
	}
	.field :global(option) {
		background: var(--recording-card);
		color: inherit;
	}
	.field {
		display: block;
		margin-top: 0.25rem;
		padding: 0.55rem 0.7rem;
		border: 1px solid rgb(128 128 128 / 0.3);
		border-radius: 0.7rem;
		background: transparent;
		color: inherit;
	}
	.primary,
	.secondary {
		padding: 0.5rem 0.8rem;
		border-radius: 0.7rem;
		font-size: 0.85rem;
	}
	.primary {
		background: #2563eb;
		color: white;
	}
	.secondary {
		border: 1px solid rgb(128 128 128 / 0.35);
	}
	button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.task {
		border-color: var(--recording-border);
		background: var(--recording-card);
		transition:
			border-color 0.15s,
			background 0.15s;
	}
	.task:hover {
		border-color: #729be1;
	}
	.chosen {
		border-color: #3b82f6;
		background: rgb(59 130 246 / 0.08);
	}
</style>
