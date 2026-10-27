<script lang="ts">
	import { createEventDispatcher, getContext } from 'svelte';
	import { previewLegacyMigration, applyLegacyMigration } from '$lib/apis/providers';
	const i18n: any = getContext('i18n');
	const dispatch = createEventDispatcher();
	let preview: any = null;
	let error = '';
	let busy = false;
	let owners: Record<string, number> = {};
	async function load() {
		busy = true;
		error = '';
		try {
			preview = await previewLegacyMigration();
		} catch (e) {
			error = String(e);
		} finally {
			busy = false;
		}
	}
	async function migrate(source: any) {
		if (
			!confirm(
				$i18n.t(
					'Move this legacy connection into the provider registry and disable the old source. Existing model access rules and chat references are kept. Confirm?'
				)
			)
		)
			return;
		busy = true;
		error = '';
		try {
			await applyLegacyMigration({
				index: source.index,
				fingerprint: source.fingerprint,
				alias_owners: owners
			});
			await load();
			dispatch('updated');
		} catch (e) {
			error = String(e);
		} finally {
			busy = false;
		}
	}
</script>

<section
	class="mt-4 space-y-3 rounded-xl border border-gray-200 p-3 text-sm text-gray-900 dark:border-gray-700 dark:text-gray-100"
>
	<div class="flex items-center justify-between gap-2">
		<h4 class="font-medium">{$i18n.t('Legacy OpenAI connections')}</h4>
		<button
			type="button"
			class="rounded-lg border px-3 py-1.5 dark:border-gray-700"
			on:click={load}
			disabled={busy}>{$i18n.t('Preview migration')}</button
		>
	</div>
	<p class="text-xs text-gray-600 dark:text-gray-300">
		{$i18n.t(
			'The preview only reads the model list and never runs inference. The old connection keeps working until you migrate it; browser direct connections are out of scope.'
		)}
	</p>
	<ul class="list-disc space-y-1 pl-4 text-xs text-gray-600 dark:text-gray-300">
		<li>
			{$i18n.t('The server-managed provider connections above are already in the new registry.')}
		</li>
		<li>
			{$i18n.t(
				'The legacy OpenAI connections below still live in the old configuration. Migrating them keeps the saved key, the model names and the access rules.'
			)}
		</li>
		<li>
			{$i18n.t(
				'The browser direct connections in the personal settings run from this browser and are not part of this migration.'
			)}
		</li>
	</ul>
	{#if error}<p role="alert" class="text-red-600 dark:text-red-300">{error}</p>{/if}
	{#if preview}
		{#each Object.entries(preview.conflicts) as [alias, ids]}<label class="block text-xs"
				>{$i18n.t('Owner of the duplicate model {{alias}}', { alias })}<select
					class="ml-2 rounded bg-gray-100 p-2 dark:bg-gray-800"
					bind:value={owners[alias]}
					><option value={undefined}>{$i18n.t('Choose a source')}</option
					>{#each ids as index}<option value={index}
							>{$i18n.t('Connection {{index}}', { index: Number(index) + 1 })}</option
						>{/each}</select
				></label
			>{/each}
		{#each preview.sources as source}<article
				class="space-y-2 rounded-lg border p-3 dark:border-gray-700"
			>
				<h5>{source.name}</h5>
				<p class="break-all text-xs">{source.base_url}</p>
				<p class="text-xs">
					{$i18n.t('{{count}} models · the original access rules are kept', {
						count: source.models.length
					})}
				</p>
				<p class="break-all text-xs">{Object.keys(source.aliases).join('、')}</p>
				{#if source.blocked_reason}<p class="text-xs text-amber-700 dark:text-amber-300">
						{source.blocked_reason}
					</p>{/if}<button
					type="button"
					class="rounded-lg border px-3 py-1.5 disabled:opacity-50 dark:border-gray-700"
					disabled={busy || !!source.blocked_reason || !!source.migrated_connection}
					on:click={() => migrate(source)}
					>{source.migrated_connection
						? $i18n.t('Migrated')
						: $i18n.t('Migrate this connection')}</button
				>
			</article>{/each}
	{/if}
</section>
