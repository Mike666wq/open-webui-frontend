<script lang="ts">
	import { getContext, tick } from 'svelte';
	import { toast } from 'svelte-sonner';
	import dayjs from 'dayjs';

	import Modal from '$lib/components/common/Modal.svelte';
	import { getKnowledgeBases } from '$lib/apis/knowledge';
	import {
		addFileToKnowledgeById,
		renameFileById,
		updateFileDataContentById,
		updateFileFromKnowledgeById,
		uploadFile
	} from '$lib/apis/files';
	import { getNoteById, updateNoteById } from '$lib/apis/notes';
	import { removeSnapshot, snapshotIds, snapshotState, upsertSnapshot } from '../note-knowledge';

	import BookOpen from '$lib/components/icons/BookOpen.svelte';
	import Document from '$lib/components/icons/Document.svelte';
	import Spinner from '$lib/components/common/Spinner.svelte';
	import GarbageBin from '$lib/components/icons/GarbageBin.svelte';

	const i18n = getContext<typeof import('$lib/i18n').default>('i18n');

	export let show = false;
	export let note: any = null;
	// Called with the updated note after a successful save or mapping removal.
	export let onSaved: (note: any) => void = () => {};

	let knowledge: any[] = [];
	let freshNote: any = null;
	let selectedKnowledgeId = '';
	let loading = false;
	let saving = false;
	let removing: string | null = null;
	let error = '';

	const writableBases = () =>
		knowledge.filter((k) => k.write_access !== false && k.type !== 'external');

	const extractError = (e: any) =>
		e?.detail?.message ?? (typeof e?.detail === 'string' ? e.detail : e?.message) ?? String(e);

	$: if (show && note?.id) {
		load();
	}

	async function load() {
		loading = true;
		error = '';
		try {
			const [bases, fetched] = await Promise.all([
				getKnowledgeBases(localStorage.token),
				getNoteById(localStorage.token, note.id)
			]);
			knowledge = Array.isArray(bases) ? bases : (bases.items ?? []);
			freshNote = fetched;
			// Keep the previously selected base when it is still available.
			if (!writableBases().some((k) => k.id === selectedKnowledgeId)) {
				selectedKnowledgeId = writableBases()[0]?.id ?? '';
			}
		} catch (e) {
			error = extractError(e);
		} finally {
			loading = false;
		}
	}

	$: savedIds = freshNote ? snapshotIds(freshNote.meta) : [];

	function baseName(id: string) {
		return knowledge.find((k) => k.id === id)?.name ?? null;
	}

	$: currentState =
		freshNote && selectedKnowledgeId
			? snapshotState(freshNote.meta, selectedKnowledgeId, freshNote.title ?? '', freshNote.data?.content?.md ?? '')
			: 'new';

	const saveToKnowledge = async (force = false) => {
		if (!freshNote || !selectedKnowledgeId || saving) return;
		if (currentState === 'synced' && !force) return;

		saving = true;
		error = '';
		try {
			// Always sync from the server state: the fingerprint must describe the
			// exact bytes that get uploaded, or idempotency breaks (K2/K3).
			const fresh = await getNoteById(localStorage.token, freshNote.id);
			const title = fresh.title || $i18n.t('Untitled');
			const content = fresh.data?.content?.md ?? '';
			const filename = `${title.replace(/[\\/:*?"<>|]/g, '_')}.md`;

			let fileId = fresh.meta?.note_knowledge?.[selectedKnowledgeId]?.file_id;
			if (fileId) {
				await renameFileById(localStorage.token, fileId, filename);
				await updateFileDataContentById(localStorage.token, fileId, content);
				await updateFileFromKnowledgeById(localStorage.token, selectedKnowledgeId, fileId);
			} else {
				const file = await uploadFile(
					localStorage.token,
					new File([content], filename, { type: 'text/markdown' }),
					null,
					true,
					true
				);
				if (!file || file.error) {
					throw new Error(file?.error ?? $i18n.t('Failed to save to knowledge base'));
				}
				await addFileToKnowledgeById(localStorage.token, selectedKnowledgeId, file.id);
				fileId = file.id;
			}

			// Meta is only written after every file operation succeeded, so a
			// failure leaves the note and existing mappings untouched (K3).
			const meta = upsertSnapshot(fresh.meta ?? {}, selectedKnowledgeId, fileId, title, content);
			const updated = await updateNoteById(localStorage.token, fresh.id, {
				title: fresh.title,
				data: fresh.data,
				meta
			});
			freshNote = updated ?? { ...fresh, meta };
			onSaved(freshNote);

			toast.success(
				$i18n.t('Saved {{document}} to {{knowledge}}', {
					document: title,
					knowledge: baseName(selectedKnowledgeId) ?? selectedKnowledgeId
				})
			);
		} catch (e) {
			error = extractError(e);
			toast.error(`${$i18n.t('Failed to save to knowledge base')}: ${error}`);
		} finally {
			saving = false;
		}
	};

	const removeMapping = async (knowledgeId: string) => {
		if (!freshNote || removing) return;
		removing = knowledgeId;
		error = '';
		try {
			const fresh = await getNoteById(localStorage.token, freshNote.id);
			const meta = removeSnapshot(fresh.meta ?? {}, knowledgeId);
			const updated = await updateNoteById(localStorage.token, fresh.id, {
				title: fresh.title,
				data: fresh.data,
				meta
			});
			freshNote = updated ?? { ...fresh, meta };
			onSaved(freshNote);
		} catch (e) {
			error = extractError(e);
		} finally {
			removing = null;
		}
	};
</script>

<Modal bind:show size="sm">
	<div class="flex flex-col gap-3">
		<div class="flex items-center gap-2">
			<BookOpen className="size-5" />
			<div class="text-lg font-medium">{$i18n.t('Save to knowledge base')}</div>
		</div>

		{#if error}
			<div role="alert" class="rounded-xl bg-red-500/10 p-3 text-sm break-words">{error}</div>
		{/if}

		{#if loading}
			<div class="flex items-center justify-center py-8">
				<Spinner className="size-5" />
			</div>
		{:else}
			{#if savedIds.length > 0}
				<div class="flex flex-col gap-2">
					<div class="text-xs font-medium text-gray-500 dark:text-gray-400">
						{$i18n.t('Saved to knowledge')}
					</div>
					{#each savedIds as savedId (savedId)}
						{@const name = baseName(savedId)}
						{@const state = snapshotState(
							freshNote.meta,
							savedId,
							freshNote.title ?? '',
							freshNote.data?.content?.md ?? ''
						)}
						<div
							class="flex items-center gap-2 rounded-xl bg-gray-50 dark:bg-gray-850 px-3 py-2 text-sm"
						>
							<Document className="size-4 shrink-0" />
							{#if name === null}
								<span class="min-w-0 flex-1 truncate italic text-gray-500 dark:text-gray-400">
									{$i18n.t('This knowledge base is unavailable or deleted')}
								</span>
								<button
									class="shrink-0 p-1 rounded-lg hover:bg-gray-200/60 dark:hover:bg-gray-700/60 transition"
									aria-label={$i18n.t('Remove')}
									disabled={removing !== null}
									on:click={() => removeMapping(savedId)}
								>
									{#if removing === savedId}
										<Spinner className="size-3.5" />
									{:else}
										<GarbageBin className="size-3.5" strokeWidth="2" />
									{/if}
								</button>
							{:else}
								<a
									class="min-w-0 flex-1 truncate hover:underline"
									href={`/workspace/knowledge/${savedId}`}>{name}</a
								>
								{#if state === 'synced'}
									<span
										data-testid="knowledge-state-{savedId}"
										class="shrink-0 rounded-full bg-green-500/10 text-green-600 dark:text-green-400 px-2 py-0.5 text-xs"
									>
										{$i18n.t('Snapshot up to date')}
									</span>
								{:else}
									<span
										data-testid="knowledge-state-{savedId}"
										class="shrink-0 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 px-2 py-0.5 text-xs"
									>
										{$i18n.t('Snapshot has changes')}
									</span>
								{/if}
								<span class="shrink-0 text-xs text-gray-500 dark:text-gray-400">
									{dayjs(freshNote.meta.note_knowledge[savedId].updated_at)
										.locale($i18n.language)
										.fromNow()}
								</span>
							{/if}
						</div>
					{/each}
				</div>
			{/if}

			<div class="flex flex-col gap-2">
				<div class="text-xs font-medium text-gray-500 dark:text-gray-400">
					{$i18n.t('Select knowledge base')}
				</div>
				<select
					class="w-full rounded-xl text-sm py-2 px-3.5 w-full dark:text-gray-300 bg-gray-50 dark:bg-gray-850 outline-hidden"
					bind:value={selectedKnowledgeId}
					disabled={saving}
				>
					{#each writableBases() as base (base.id)}
						<option value={base.id}>{base.name}</option>
					{/each}
				</select>

				<div class="flex items-center justify-end gap-2 pt-1">
					{#if currentState === 'synced'}
						<span class="text-xs text-gray-500 dark:text-gray-400 mr-auto">
							{$i18n.t('Snapshot up to date')}
						</span>
						<button
							class="text-sm px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-850 hover:bg-gray-200/60 dark:hover:bg-gray-800 transition disabled:cursor-not-allowed disabled:opacity-50"
							disabled={saving}
							on:click={() => saveToKnowledge(true)}
						>
							{saving ? $i18n.t('Saving...') : $i18n.t('Force update')}
						</button>
					{:else}
						<button
							data-testid="save-to-knowledge-confirm"
							class="text-sm px-3 py-1.5 rounded-lg bg-black text-white dark:bg-white dark:text-black hover:opacity-80 transition disabled:cursor-not-allowed disabled:opacity-50 flex items-center gap-1.5"
							disabled={!selectedKnowledgeId || saving}
							on:click={() => saveToKnowledge(false)}
						>
							{#if saving}
								<Spinner className="size-3.5" />
							{/if}
							{currentState === 'changed' ? $i18n.t('Update') : $i18n.t('Save')}
						</button>
					{/if}
				</div>
			</div>
		{/if}
	</div>
</Modal>
