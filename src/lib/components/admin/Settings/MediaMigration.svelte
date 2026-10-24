<script lang="ts">
	import { config } from '$lib/stores';
	import { onMount, getContext } from 'svelte';
	import { getMediaMigration, migrateMediaSetting } from '$lib/apis/providers';
	export let purposes: string[] = [];
	const i18n: any = getContext('i18n');
	let rows: any[] = [];
	let error = '';
	let busy = false;
	async function load() {
		try {
			rows = await getMediaMigration();
		} catch (e) {
			error = String(e);
		}
	}
	onMount(() => {
		if ($config?.features?.enable_provider_model_capabilities) load();
	});
	async function migrate(row: any) {
		if (
			!confirm(
				$i18n.t(
					'Create a private connection and switch this default model? Other users will need explicit access. Reload this settings page after migration.'
				)
			)
		)
			return;
		busy = true;
		error = '';
		try {
			await migrateMediaSetting(row.purpose, row.fingerprint);
			await load();
			location.reload();
		} catch (e) {
			error = String(e);
		} finally {
			busy = false;
		}
	}
</script>

{#each rows.filter((row) => purposes.includes(row.purpose)) as row}
	<div class="mb-3 rounded-lg border border-amber-300 p-3 text-sm">
		<p>{$i18n.t('Legacy configuration')} · {row.purpose} · {row.model}</p>
		<p class="break-all text-xs">{row.base_url}</p>
		<p class="my-1 text-xs">
			{$i18n.t(
				'Migration creates a private connection. Existing connections are not automatically merged.'
			)}
		</p>
		{#if row.matching_connections?.length}<p class="text-xs">
				{$i18n.t('Matching private connections')}: {row.matching_connections.join(', ')}
			</p>{/if}
		<button
			type="button"
			class="rounded border px-2 py-1"
			disabled={busy || !row.configured}
			on:click={() => migrate(row)}>{$i18n.t('Migrate to unified models')}</button
		>
	</div>
{/each}
{#if error}<p class="text-xs text-red-500">{error}</p>{/if}
