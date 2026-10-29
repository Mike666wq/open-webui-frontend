<script lang="ts">
	import { getContext, onDestroy } from 'svelte';
	import Modal from '$lib/components/common/Modal.svelte';
	import { fetchProviderVoices } from '$lib/apis/providers';
	import { runProviderTestSession, type TestEvent } from './provider-test-session';
	import { providerErrorHint, providerErrorSummary } from '$lib/utils/provider-errors';
	import { classifiedResult, providerResults, requestFailureResult, successfulResult } from './provider-models-feedback';
	import { PURPOSE_LABEL_KEYS } from '$lib/utils/provider-models';
	import {
		serviceDeclaration,
		type ProviderServiceTemplate,
		type ServicePurpose
	} from '$lib/utils/provider-services';

	const i18n: any = getContext('i18n');

	export let show = false;
	export let connection: any = null;
	export let template: ProviderServiceTemplate | null = null;
	export let model: any = null;
	export let purpose: ServicePurpose = 'chat';
	export let onTested: (() => Promise<void>) | undefined = undefined;
	export let onResult: (() => void) | undefined = undefined;

	let voice = '';
	let voices: { id: string; name: string }[] = [];
	let loadingVoices = false;
	let audioName = '';
	let audioBase64 = '';
	let audioError = '';
	let text = '';
	let prompt = '';
	let size = '1024x1024';
	let count = 1;
	let responseFormat = 'json';
	let language = '';
	let running = false;
	let result: any = null;
	let error = '';
	let controller: AbortController | null = null;
	let generation = 0;
	let timer: ReturnType<typeof setInterval> | null = null;
	let browserMs = 0;
	let phase = '';
	let stages: { phase: TestEvent['phase']; elapsed_ms: number }[] = [];
	let preview = '';
	let fallback = false;

	$: declaration = serviceDeclaration(template, purpose);
	$: isChat = purpose === 'chat';
	$: isTranscription = purpose === 'transcription';
	$: isSpeech = purpose === 'speech';
	$: isImage = purpose === 'image';
	$: endpoint = connection?.resolved_services?.[purpose]?.endpoint ?? '';
	$: supportedSizes = ['512x512', '768x768', '1024x1024', '1280x720', '720x1280', '1536x1024'];
	$: responseFormats = (declaration.options?.response_format as string[]) ?? ['json'];

	const readableError = (err: unknown) => String(err).replace(/^Error:\s*/, '');

	function reset() {
		generation += 1;
		controller?.abort();
		controller = null;
		if (timer) clearInterval(timer);
		timer = null;
		running = false;
		browserMs = 0;
		phase = '';
		stages = [];
		preview = '';
		fallback = false;
		voice = '';
		voices = [];
		audioName = '';
		audioBase64 = '';
		audioError = '';
		text = '';
		prompt = '';
		size = '1024x1024';
		count = 1;
		responseFormat = 'json';
		language = '';
		result = null;
		error = '';
	}

	function close() { show = false; reset(); }
	onDestroy(reset);

	/**
	 * The audio sample never leaves the browser in the clear: it is sent to the
	 * server as base64 and forwarded to the provider by the server, not by the
	 * browser.
	 */
	async function onAudio(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		audioError = '';
		if (!file) {
			audioName = '';
			audioBase64 = '';
			return;
		}
		if (file.size > 2 * 1024 * 1024) {
			audioError = $i18n.t('Select a short audio sample under 2 MB');
			audioName = '';
			audioBase64 = '';
			return;
		}
		audioName = file.name;
		const buffer = await file.arrayBuffer();
		let binary = '';
		const bytes = new Uint8Array(buffer);
		for (let index = 0; index < bytes.length; index += 1) {
			binary += String.fromCharCode(bytes[index]);
		}
		audioBase64 = btoa(binary);
	}

	async function loadVoices() {
		if (!connection?.id) return;
		loadingVoices = true;
		error = '';
		try {
			const result = await fetchProviderVoices(connection.id, 'speech', 'system');
			voices = Array.isArray(result?.data) ? result.data : [];
			if (voices.length === 0) {
				error = $i18n.t('This service did not return any voice.');
			}
		} catch (err) {
			error = readableError(err);
		} finally {
			loadingVoices = false;
		}
	}

	async function run() {
		if (running) return;
		running = true;
		result = null;
		error = '';
		preview = '';
		phase = '';
		stages = [];
		fallback = false;
		const session = ++generation;
		const sessionController = new AbortController();
		controller = sessionController;
		const connectionId = connection.id;
		const purposeName = $i18n.t(PURPOSE_LABEL_KEYS[purpose] ?? purpose);
		const modelName = model?.name ?? model?.upstream_id;
		const started = performance.now();
		let timedOut = false;
		const timeout = setTimeout(() => { timedOut = true; sessionController.abort(); }, 120_000);
		browserMs = 0;
		timer = setInterval(() => (browserMs = Math.round(performance.now() - started)), 100);
		try {
			const payload: Record<string, unknown> = {
				upstream_id: model?.upstream_id,
				purpose
			};
			if (isTranscription) {
				if (!audioBase64) {
					error = $i18n.t('Select an audio sample first.');
					return;
				}
				payload.audio_base64 = audioBase64;
				payload.filename = audioName;
				payload.response_format = responseFormat;
				if (language.trim()) payload.language = language.trim();
			}
			if (isSpeech) {
				if (!voice.trim()) {
					error = $i18n.t('Select a voice for this model');
					return;
				}
				payload.voice = voice.trim();
				if (text.trim()) payload.text = text.trim();
			}
			if (isImage) {
				if (prompt.trim()) payload.prompt = prompt.trim();
				payload.size = size;
				payload.count = count;
			}
			const response = await runProviderTestSession(connection.id, payload, sessionController.signal, (event: TestEvent) => {
				if (session !== generation) return;
				phase = event.phase;
				if (event.phase !== 'output_delta') stages = [...stages, { phase: event.phase, elapsed_ms: event.elapsed_ms }];
				if (event.phase === 'output_delta' && typeof event.data?.text === 'string') {
					preview = new TextDecoder().decode(new TextEncoder().encode(preview + event.data.text).slice(0, 8192));
				}
			});
			if (session !== generation) return;
			result = response.result;
			fallback = response.fallback;
			providerResults.set(connectionId, result?.status === 'passed'
				? successfulResult('test', $i18n.t('The request passed. It does not mean every parameter is compatible.'), Date.now(), purposeName, modelName)
				: classifiedResult('test', result?.error, { authType: connection.auth_type }, Date.now(), purposeName, modelName));
			onResult?.();
			if (onTested) await onTested();
		} catch (err) {
			if (session === generation) {
				error = timedOut ? '测试超时，可能已产生费用 / Test timed out and may have been charged.' : readableError(err);
				if (!sessionController.signal.aborted || timedOut) {
					providerResults.set(connectionId, requestFailureResult('test', err, Date.now(), purposeName, modelName, { authType: connection.auth_type }));
					onResult?.();
				}
			}
		} finally {
			clearTimeout(timeout);
			if (session === generation) {
				running = false;
				browserMs = Math.round(performance.now() - started);
				if (timer) clearInterval(timer);
				timer = null;
				controller = null;
			}
		}
	}
</script>

<Modal bind:show size="md" onRequestClose={close}>
	<div class="flex flex-col gap-4" aria-labelledby="provider-model-test-title">
		<h3 id="provider-model-test-title" class="text-lg font-semibold">
			{$i18n.t('Test {{purpose}}', {
				purpose: $i18n.t(PURPOSE_LABEL_KEYS[purpose] ?? purpose)
			})}
		</h3>

		<div class="rounded-lg bg-gray-100 p-3 text-xs dark:bg-gray-800">
			<p class="font-medium">{model?.name ?? model?.upstream_id}</p>
			{#if endpoint}
				<p class="mt-1 break-all text-gray-600 dark:text-gray-300">{endpoint}</p>
			{/if}
			<p class="mt-1 text-gray-600 dark:text-gray-300">
				{$i18n.t(
					'This sends one request and may consume quota. It is never retried automatically.'
				)}
			</p>
		</div>

		{#if isTranscription}
			<label class="block text-xs">
				{$i18n.t('Audio sample')}
				<input
					type="file"
					accept="audio/*"
					class="mt-1 w-full text-xs"
					data-testid="provider-test-audio"
					on:change={onAudio}
				/>
			</label>
			{#if audioError}
				<p class="text-xs text-red-600 dark:text-red-400">{audioError}</p>
			{/if}
			<label class="block text-xs">
				{$i18n.t('Result format')}
				<select
					class="mt-1 w-full rounded-lg bg-gray-100 p-2 dark:bg-gray-800"
					bind:value={responseFormat}
				>
					{#each responseFormats as format (format)}
						<option value={format}>{format}</option>
					{/each}
				</select>
			</label>
			<label class="block text-xs">
				{$i18n.t('Language (optional)')}
				<input
					class="mt-1 w-full rounded-lg border bg-transparent p-2 dark:border-gray-700"
					bind:value={language}
					placeholder={$i18n.t('Leave empty to let the provider decide')}
				/>
			</label>
		{:else if isSpeech}
			<div class="space-y-2">
				<label class="block text-xs">
					{$i18n.t('Voice')}
					<div class="mt-1 flex gap-2">
						<input
							class="w-full rounded-lg border bg-transparent p-2 dark:border-gray-700"
							bind:value={voice}
							data-testid="provider-test-voice"
							placeholder={$i18n.t('Voice id')}
						/>
						<button
							type="button"
							class="rounded-lg border px-3 text-xs disabled:opacity-50 dark:border-gray-700"
							disabled={loadingVoices}
							data-testid="provider-test-fetch-voices"
							on:click={loadVoices}
						>
							{loadingVoices ? $i18n.t('Loading…') : $i18n.t('Fetch voices')}
						</button>
					</div>
				</label>
				{#if voices.length > 0}
					<select
						class="w-full rounded-lg bg-gray-100 p-2 text-xs dark:bg-gray-800"
						data-testid="provider-test-voice-list"
						on:change={(event) => (voice = (event.currentTarget as HTMLSelectElement).value)}
					>
						<option value="">{$i18n.t('Select a voice')}</option>
						{#each voices as item (item.id)}
							<option value={item.id}>{item.name}</option>
						{/each}
					</select>
				{/if}
				<label class="block text-xs">
					{$i18n.t('Text (optional)')}
					<input
						class="mt-1 w-full rounded-lg border bg-transparent p-2 dark:border-gray-700"
						bind:value={text}
					/>
				</label>
			</div>
		{:else if isImage}
			<label class="block text-xs">
				{$i18n.t('Prompt (optional)')}
				<input
					class="mt-1 w-full rounded-lg border bg-transparent p-2 dark:border-gray-700"
					bind:value={prompt}
				/>
			</label>
			<div class="grid gap-2 sm:grid-cols-2">
				<label class="block text-xs">
					{$i18n.t('Size')}
					<select
						class="mt-1 w-full rounded-lg bg-gray-100 p-2 dark:bg-gray-800"
						bind:value={size}
					>
						{#each supportedSizes as value (value)}
							<option value={value}>{value}</option>
						{/each}
					</select>
				</label>
				<label class="block text-xs">
					{$i18n.t('Images')}
					<input
						type="number"
						min="1"
						max="9"
						class="mt-1 w-full rounded-lg border bg-transparent p-2 dark:border-gray-700"
						bind:value={count}
					/>
				</label>
			</div>
		{/if}

		{#if running || phase || result}
			<div class="space-y-1 rounded-lg bg-gray-100 p-3 text-xs dark:bg-gray-800" role="status" aria-live="polite" data-testid="provider-test-timeline">
				<p>{phase === 'accepted' ? '已接受 / Accepted' : phase === 'request_started' ? '请求中 / Requesting' : phase === 'response_headers' || phase === 'output_delta' ? '接收中 / Receiving' : phase === 'completed' ? '完成 / Completed' : phase === 'failed' ? '失败 / Failed' : '等待中 / Waiting'}</p>
				<ol class="space-y-1" aria-label="测试过程 / Test timeline">
					{#each stages as stage}
						<li>{stage.phase === 'accepted' ? '已接受 / Accepted' : stage.phase === 'request_started' ? '请求已开始 / Request started' : stage.phase === 'response_headers' ? '已收到响应头 / Response headers' : stage.phase === 'completed' ? '完成 / Completed' : '失败 / Failed'} · {stage.elapsed_ms} ms</li>
					{/each}
				</ol>
				<p>浏览器等待 / Browser elapsed: {browserMs} ms</p>
				{#if result}
					<p>测试总耗时 / Test total: {result.elapsed_ms ?? '未测得 / Unavailable'} ms</p>
					<p>首输出 / First output: {result.timings?.first_output_ms == null ? '未测得 / Unavailable' : `${result.timings.first_output_ms} ms`}</p>
					{#if result.usage}<p>用量 / Usage: {JSON.stringify(result.usage)}</p>{/if}
					{#if fallback}<p>旧版服务，仅测总耗时 / Legacy server: total time only.</p>{/if}
				{/if}
				{#if preview}<pre class="max-h-40 overflow-auto whitespace-pre-wrap break-words">{preview}</pre>{/if}
				{#if result?.sample_text}<p class="whitespace-pre-wrap break-words">{result.sample_text}</p>{/if}
				{#if result?.sample_audio_base64}<audio controls src={`data:audio/mpeg;base64,${result.sample_audio_base64}`}>Audio playback unavailable</audio>{/if}
			</div>
		{/if}

		{#if result}
			<div
				role="status"
				class="rounded-lg p-3 text-xs {result.status === 'passed'
					? 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300'
					: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'}"
				data-testid="provider-test-result"
			>
				{#if result.status === 'passed'}
					<p>{$i18n.t('The request passed. It does not mean every parameter is compatible.')}</p>
				{:else}
					<p class="break-words">{providerErrorSummary(result.error)}</p>
					<p class="mt-1 break-words leading-relaxed">{providerErrorHint(result.error)}</p>
				{/if}
				{#if result.service?.endpoint}
					<p class="mt-1 break-all text-gray-600 dark:text-gray-300">{result.service.endpoint}</p>
				{/if}
			</div>
		{/if}

		{#if error}
			<p role="status" class="rounded-lg bg-red-50 p-3 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
				{error}
			</p>
		{/if}

		<div class="flex flex-wrap justify-end gap-2">
			<button
				type="button"
				class="rounded-lg border px-3 py-2 text-sm dark:border-gray-700"
				data-testid="provider-test-cancel"
				on:click={close}
			>
				{$i18n.t('Cancel')}
			</button>
			<button
				type="button"
				class="rounded-lg bg-black px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-black"
				disabled={running}
				data-testid="provider-test-run"
				on:click={run}
			>
				{running ? $i18n.t('Testing…') : $i18n.t('Send one request')}
			</button>
		</div>
	</div>
</Modal>
