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
	import { uploadFile, updateFileDataContentById } from '$lib/apis/files';
	import {
		recordingRequest,
		uploadRecording,
		recordingsUrl,
		type RecordingJob,
		type RecordingConfig
	} from '$lib/apis/recordings';
	import { transcriptText, timeLabel, hasCompleteSegments } from './Recordings/utils';
	const i18n = getContext<typeof import('$lib/i18n').default>('i18n');
	let selectedModelRef = '';
	let retryModelRef = '';
	let jobs: RecordingJob[] = [];
	let selected: RecordingJob | null = null;
	let configuration: RecordingConfig | null = null;
	let selectedFile: File | null = null;
	let uploadKey = '';
	let progress = 0;
	let uploading = false;
	let busy = false;
	let error = '';
	let note: any = null;
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
	$: dirty = content !== savedContent;
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
	async function execute(action: () => Promise<void>) {
		if (busy) return;
		busy = true;
		error = '';
		try {
			await action();
		} catch (e) {
			error = String(e instanceof Error ? e.message : e);
			toast.error(error);
		} finally {
			busy = false;
		}
	}
	async function loadDocument(id: string) {
		if (dirty && !window.confirm($i18n.t('Discard unsaved changes?'))) {
			documentId = note?.id ?? '';
			return;
		}
		if (!id) return;
		const loaded = await getNoteById(localStorage.token, id);
		note = loaded;
		documentId = id;
		content = savedContent = loaded?.data?.content?.md ?? '';
	}
	async function selectJob(job: RecordingJob) {
		if (dirty && !window.confirm($i18n.t('Discard unsaved changes?'))) return;
		content = savedContent;
		selected = await recordingRequest<RecordingJob>(localStorage.token, `/${job.id}`);
		retryModelRef = selected.config?.model_ref ?? '';
		speakerNames = { ...selected.speaker_names };
		summaryKey = '';
		deleteConfirm = false;
		note = null;
		documentId = '';
		content = savedContent = '';
		if (selected.state === 'completed') await loadDocument(selected.note_id);
	}
	async function refresh() {
		const rows = await recordingRequest<RecordingJob[]>(localStorage.token);
		jobs = [...rows, ...jobs.slice(50)];
		more = rows.length === 50;
		if (selected) {
			const id = selected.id;
			const result = await recordingRequest<RecordingJob>(localStorage.token, `/${id}`);
			if (selected?.id !== id) return;
			selected = result;
			if (!note && result.state === 'completed') await loadDocument(result.note_id);
		}
	}
	onMount(() => {
		let disposed = false;
		let timer: ReturnType<typeof setTimeout>;
		const poll = async () => {
			try {
				await refresh();
			} catch (e) {
				error = String(e instanceof Error ? e.message : e);
			}
			if (!disposed) timer = setTimeout(poll, 4000);
		};
		execute(async () => {
			configuration = await recordingRequest<RecordingConfig>(localStorage.token, '/config');
			selectedModelRef = configuration.default_model_ref ?? '';
			const bases = await getKnowledgeBases(localStorage.token).catch(() => []);
			knowledge = (Array.isArray(bases) ? bases : (bases.items ?? [])).filter(
				(k: any) => k.write_access !== false && k.type !== 'external'
			);
			await refresh();
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
			await refresh();
			await selectJob(job);
			selectedFile = null;
		} catch (e) {
			error = String(e instanceof Error ? e.message : e);
		} finally {
			uploading = false;
		}
	}
	async function save() {
		if (!note) return;
		note = await updateNoteById(localStorage.token, note.id, {
			title: note.title,
			data: { ...note.data, content: { md: content } },
			meta: note.meta
		});
		savedContent = content;
		toast.success($i18n.t('Saved'));
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
		if (dirty) await save();
		const fresh = await getNoteById(localStorage.token, note.id);
		const mappings = fresh.meta?.recording_knowledge ?? {};
		let fileId = mappings[knowledgeId];
		if (fileId) {
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
			note = await updateNoteById(localStorage.token, fresh.id, {
				title: fresh.title,
				data: fresh.data,
				meta: { ...fresh.meta, recording_knowledge: { ...mappings, [knowledgeId]: fileId } }
			});
		}
		toast.success($i18n.t('Knowledge snapshot updated'));
	}
</script>

<svelte:head><title>{$i18n.t('Recording to document')} / Open WebUI</title></svelte:head>
<div
	class="recordings-page w-full min-w-0 h-full overflow-y-auto {$showSidebar
		? 'md:max-w-[calc(100%-var(--sidebar-width))]'
		: ''}"
>
	<div class="recordings-surface mx-auto min-h-full max-w-6xl px-4 py-6 space-y-5">
		<header class="flex items-center justify-between gap-3">
			<div>
				<a class="text-sm underline" href="/notes">← {$i18n.t('Notes')}</a>
				<h1 class="text-2xl font-semibold mt-2">{$i18n.t('Recording to document')}</h1>
			</div>
		</header>
		<p class="text-sm text-gray-500">
			{$i18n.t(
				'Upload a recording, keep the transcript, then optionally create class notes or meeting minutes.'
			)}
		</p>
		{#if error}<div role="alert" class="rounded-xl bg-red-500/10 p-3 text-sm break-words">
				{error}
			</div>{/if}
		{#if configuration && !configuration.configured}<div
				role="status"
				class="rounded-xl bg-amber-500/10 p-3 text-sm"
			>
				{$i18n.t('Configure cloud speech-to-text in Admin Settings → Audio before uploading.')}
				<p class="mt-1">{configuration.reason}</p>
			</div>{/if}
		<section
			class="rounded-2xl border border-gray-200 dark:border-gray-800 p-4 space-y-3"
			aria-label={$i18n.t('Upload recording')}
		>
			<label class="block text-sm font-medium" for="recording-file"
				>{$i18n.t('Upload recording')}</label
			>
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
			<input
				id="recording-file"
				type="file"
				accept="audio/*,.m4a,.mp3,.wav,.webm,.ogg,.flac,.aac,.amr"
				disabled={uploading}
				on:change={(e) => {
					selectedFile = e.currentTarget.files?.[0] ?? null;
					uploadKey = uuidv4();
				}}
				class="block max-w-full text-sm"
			/>
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
			<details class="text-sm">
				<summary>{$i18n.t('Recording limits and ASR response format')}</summary>
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
		<div class="grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
			<section aria-label={$i18n.t('Transcription tasks')} class="min-w-0 space-y-2">
				<h2 class="font-semibold">{$i18n.t('Transcription tasks')}</h2>
				{#each jobs as job (job.id)}<button
						class="task w-full text-left rounded-xl border p-3"
						class:chosen={selected?.id === job.id}
						disabled={busy}
						on:click={() => execute(() => selectJob(job))}
						><span class="block truncate font-medium">{job.title}</span><span
							class="text-xs text-gray-500"
							>{$i18n.t(stateNames[job.state] ?? job.state)} · {timeLabel(job.duration)} · {job.completed_chunks}/{job.total_chunks}</span
						></button
					>{/each}
				{#if !jobs.length}<p class="text-sm text-gray-500">{$i18n.t('No recordings yet.')}</p>{/if}
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
				<section class="min-w-0 space-y-4" aria-label={$i18n.t('Recording details')}>
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
						<audio
							class="w-full"
							bind:this={audio}
							src={`${recordingsUrl}/${selected.id}/audio`}
							controls
							preload="metadata"
							aria-label={$i18n.t('Original recording')}
						></audio>
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
					{:else}<p class="text-xs text-gray-500">
							{$i18n.t('Original audio deleted. Text documents remain available.')}
						</p>{/if}
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
						{#if note}<textarea
								aria-label={$i18n.t('Document content')}
								class="field w-full min-h-80 font-mono text-sm"
								bind:value={content}
							></textarea>
							<div class="flex flex-wrap items-center gap-2">
								<button class="primary" disabled={busy || !dirty} on:click={() => execute(save)}
									>{$i18n.t('Save')}</button
								><a class="secondary" href={`/notes/${note.id}`}>{$i18n.t('Open in notes')}</a
								>{#each ['txt', 'md'] as ext}<button
										class="secondary"
										on:click={() => download(content, note.title, ext)}
										>{$i18n.t('Export document')} {ext.toUpperCase()}</button
									>{/each}
							</div>{/if}
						<div class="border-t dark:border-gray-800 pt-3 space-y-2">
							<h3 class="font-medium text-sm">{$i18n.t('Create organized notes')}</h3>
							<div class="flex flex-wrap gap-2">
								<select
									class="field min-w-0 max-w-full"
									aria-label={$i18n.t('Text model')}
									bind:value={model}
									on:change={() => (summaryKey = '')}
									><option value="">{$i18n.t('Select a model')}</option
									>{#each $models.filter((m) => !m.info?.meta?.hidden) as m}<option value={m.id}
											>{m.name || m.id}</option
										>{/each}</select
								><select
									class="field"
									aria-label={$i18n.t('Template')}
									bind:value={template}
									on:change={() => (summaryKey = '')}
									><option value="class">{$i18n.t('Class notes')}</option><option value="meeting"
										>{$i18n.t('Meeting minutes')}</option
									></select
								><button
									class="secondary"
									disabled={busy || !model}
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
										})}>{busy ? $i18n.t('Processing') : $i18n.t('Generate')}</button
								>
							</div>
							<p class="text-xs text-gray-500">
								{$i18n.t(
									'Uses the saved transcript note. The selected text model may charge separately. Original transcription is never overwritten.'
								)}
							</p>
						</div>
						{#if note}<div class="border-t dark:border-gray-800 pt-3 space-y-2">
								<h3 class="font-medium text-sm">{$i18n.t('Add or update knowledge snapshot')}</h3>
								<div class="flex flex-wrap gap-2">
									<select
										class="field max-w-full"
										aria-label={$i18n.t('Knowledge base')}
										bind:value={knowledgeId}
										><option value="">{$i18n.t('Select a knowledge base')}</option
										>{#each knowledge as base}<option value={base.id}>{base.name}</option
											>{/each}</select
									><button
										class="secondary"
										disabled={busy || !knowledgeId}
										on:click={() => execute(syncKnowledge)}
										>{$i18n.t('Save current document to knowledge')}</button
									>
								</div>
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
	.recordings-surface {
		background-color: rgb(var(--mist-surface-rgb, 255 255 255) / 0.96);
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
		border-color: rgb(128 128 128 / 0.25);
	}
	.chosen {
		border-color: #3b82f6;
		background: rgb(59 130 246 / 0.08);
	}
</style>
