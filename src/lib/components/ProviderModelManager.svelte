<script lang="ts">
	import { getContext, createEventDispatcher } from 'svelte';
	import { setProviderModelUses, testProviderModel } from '$lib/apis/providers';
	export let connection: any;
	const i18n: any = getContext('i18n');
	const dispatch = createEventDispatcher();
	const purposes = ['chat', 'transcription', 'speech', 'image'];
	const labels: Record<string, string> = {
		chat: 'Chat',
		transcription: 'Transcription',
		speech: 'Speech synthesis',
		image: 'Image generation'
	};
	const adapters: Record<string, string[]> = {
		chat: ['openai-chat', 'responses'],
		transcription: ['openai-transcription'],
		speech: ['openai-speech'],
		image: ['openai-image', 'siliconflow-image']
	};
	let modelId = '';
	let uses: Record<string, string> = {};
	let file: File | null = null;
	let voice = '';
	let busy = false;
	let message = '';
	function select(id: string) {
		modelId = id;
		uses = { ...(connection.models?.find((m: any) => m.upstream_id === id)?.uses ?? {}) };
		message = '';
	}
	async function save() {
		busy = true;
		message = '';
		try {
			await setProviderModelUses(connection.id, modelId, uses);
			message = $i18n.t('Saved');
			dispatch('updated');
		} catch (e) {
			message = String(e);
		} finally {
			busy = false;
		}
	}
	async function test(purpose: string) {
		if (
			!confirm(
				$i18n.t('This test sends one paid inference request using this connection. Continue?')
			)
		)
			return;
		busy = true;
		message = '';
		try {
			let audio_base64: string | undefined;
			if (purpose === 'transcription') {
				if (!file || file.size > 2 * 1024 * 1024)
					throw new Error($i18n.t('Select a short audio sample under 2 MB.'));
				const bytes = new Uint8Array(await file.arrayBuffer());
				let binary = '';
				for (const b of bytes) binary += String.fromCharCode(b);
				audio_base64 = btoa(binary);
			}
			const result = await testProviderModel(connection.id, {
				upstream_id: modelId,
				purpose,
				voice,
				audio_base64,
				filename: file?.name
			});
			message = $i18n.t(result.status);
			dispatch('updated');
		} catch (e) {
			message = String(e);
		} finally {
			busy = false;
		}
	}
</script>

<details class="mt-2 text-xs" tabindex="-1">
	<summary class="cursor-pointer">{$i18n.t('Model capabilities and tests')}</summary>
	<p class="my-2 text-gray-500">
		{$i18n.t('Discovery does not run inference. Manual capabilities are not verification.')}
	</p>
	<div class="max-h-48 overflow-y-auto">
		{#each connection.models ?? [] as model}<button
				type="button"
				class="block w-full rounded p-2 text-left hover:bg-gray-100 dark:hover:bg-gray-800"
				on:click={() => select(model.upstream_id)}
				>{model.name ?? model.upstream_id} · {Object.keys(model.uses ?? {})
					.map((p) => $i18n.t(labels[p]))
					.join(' / ') || $i18n.t('Unclassified')} · {model.capability_source}</button
			>{/each}
	</div>
	{#if connection.auth_type === 'api_key'}
		<label class="mt-2 block"
			>{$i18n.t('Model ID')}<input
				class="mt-1 w-full rounded bg-gray-50 p-2 dark:bg-gray-850"
				bind:value={modelId}
			/></label
		>
		{#each purposes as purpose}
			<label class="mt-2 flex items-center gap-2"
				><input
					type="checkbox"
					checked={!!uses[purpose]}
					on:change={(e) => {
						const next = { ...uses };
						if (e.currentTarget.checked) next[purpose] = adapters[purpose][0];
						else delete next[purpose];
						uses = next;
					}}
				/>{$i18n.t(labels[purpose])}
				{#if uses[purpose]}<select aria-label={$i18n.t(labels[purpose])} bind:value={uses[purpose]}
						>{#each adapters[purpose].filter((a) => a !== 'siliconflow-image' || connection.provider_id === 'siliconflow') as adapter}<option
								value={adapter}>{adapter}</option
							>{/each}</select
					>{/if}</label
			>
		{/each}
		<button
			type="button"
			class="my-2 rounded border px-3 py-1"
			disabled={busy || !modelId.trim()}
			on:click={save}>{$i18n.t('Save capabilities')}</button
		>
		{#if modelId && connection.models?.some((m: any) => m.upstream_id === modelId)}
			<p>{$i18n.t('Save capability changes before testing. Tests use the saved configuration.')}</p>
			<label class="mt-2 block"
				>{$i18n.t('Short transcription test sample')}<input
					type="file"
					accept="audio/*"
					on:change={(e) => (file = e.currentTarget.files?.[0] ?? null)}
				/></label
			>
			<label class="mt-2 block"
				>{$i18n.t('Test voice ID')}<input
					class="rounded bg-gray-50 p-2 dark:bg-gray-850"
					bind:value={voice}
				/></label
			>
			{#each Object.keys(connection.models?.find((m: any) => m.upstream_id === modelId)?.uses ?? {}) as purpose}<button
					type="button"
					class="mr-2 mt-2 rounded border px-2 py-1"
					disabled={busy}
					on:click={() => test(purpose)}
					>{$i18n.t('Test model')} · {$i18n.t(labels[purpose])} · {$i18n.t(
						connection.models?.find((m: any) => m.upstream_id === modelId)?.verification?.[purpose]
							?.status ?? 'untested'
					)}</button
				>{/each}
		{/if}
	{/if}
	{#if message}<p class="mt-2 break-words" role="status">{message}</p>{/if}
</details>
