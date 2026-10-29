<script lang="ts">
	import { getContext } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { marked } from 'marked';

	import Modal from '$lib/components/common/Modal.svelte';
	import Spinner from '$lib/components/common/Spinner.svelte';
	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import { uploadFile } from '$lib/apis/files';
	import { createNewNote, getNotes, updateNoteById } from '$lib/apis/notes';
	import { computeFileHash } from '$lib/utils/hash';
	import {
		analyzeMarkdownNote,
		buildImportPreview,
		crossBatchAssetKey,
		markdownImportMeta,
		noteContentHash,
		parseImageRefs,
		rewriteImageRefs,
		type ImportPreview
	} from '../markdown-import';
	import {
		buildBatchPlan,
		copyTitle,
		renderTreeLines,
		type ImportEntry
	} from './notes-import-plan';

	const i18n = getContext<typeof import('$lib/i18n').default>('i18n');

	export let show = false;
	/** Refresh the notes list after notes were created or updated. */
	export let onCompleted: () => void = () => {};
	/** Last import report, kept by the parent so it can be re-opened. */
	export let report: ImportReport | null = null;

	// ── Types ────────────────────────────────────────────────────────────────────

	type ConflictStrategy = 'skip' | 'overwrite' | 'copy';

	type ReportItem = {
		path: string;
		title: string;
		status: 'created' | 'updated' | 'copy' | 'skipped' | 'unchanged' | 'failed';
		note_id?: string;
		reason?: string;
	};

	type MissingImage = { md: string; path: string; reason: string };

	type OrphanImage = { md: string; path: string; file_id: string | null };

	export type ImportReport = {
		mode: 'single' | 'batch';
		started_at: number;
		finished_at?: number;
		cancelled: boolean;
		totals: {
			markdown: number;
			created: number;
			updated: number;
			copies: number;
			skipped: number;
			unchanged: number;
			failed: number;
			images_uploaded: number;
			images_deduped: number;
			other_docs: number;
			missing_images: number;
			orphan_images: number;
		};
		items: ReportItem[];
		missing_images: MissingImage[];
		orphans: OrphanImage[];
		invalid_paths: { relativePath: string; reason: string }[];
	};

	// ── UI state ─────────────────────────────────────────────────────────────────

	let mode: 'single' | 'batch' = 'single';
	let view: 'select' | 'preview' | 'running' | 'report' = 'select';

	let singleFiles: ImportEntry[] = [];
	let resourceFiles: ImportEntry[] = [];
	let batchFiles: ImportEntry[] = [];

	let filesInputElement: HTMLInputElement;
	let dirInputElement: HTMLInputElement;
	let batchInputElement: HTMLInputElement;

	let flatTitles = false;
	let importOtherDocs = false;
	let conflictStrategy: ConflictStrategy = 'skip';

	let preview: ImportPreview | null = null;
	let previewTreeLines: string[] = [];
	let overThresholdMds: { path: string; refs: number }[] = [];

	let running = false;
	let cancelRequested = false;
	let progress = { done: 0, total: 0, current: '' };

	let error = '';

	const thresholdRefCount = 50;
	const thresholdFileCount = 500;

	const extractError = (e: any): string =>
		e?.detail?.message ?? (typeof e?.detail === 'string' ? e.detail : e?.message) ?? String(e);

	$: if (show && report) {
		view = 'report';
	}

	const openSelect = () => {
		view = 'select';
		preview = null;
		error = '';
	};

	const clearAll = () => {
		singleFiles = [];
		resourceFiles = [];
		batchFiles = [];
		overThresholdMds = [];
		preview = null;
		if (filesInputElement) filesInputElement.value = '';
		if (dirInputElement) dirInputElement.value = '';
		if (batchInputElement) batchInputElement.value = '';
	};

	// ── File collection ──────────────────────────────────────────────────────────

	const hasHiddenFolder = (path: string): boolean =>
		path.split('/').some((part) => part.startsWith('.'));

	const collectFromInput = (input: HTMLInputElement): ImportEntry[] => {
		const files = Array.from(input.files ?? []).filter(
			(file) => !file.name.startsWith('.') && !hasHiddenFolder(file.webkitRelativePath)
		);
		return files.map((file) => ({
			relativePath: file.webkitRelativePath || file.name,
			file
		}));
	};

	const addSingleFiles = () => {
		if (!filesInputElement) return;
		const entries = collectFromInput(filesInputElement);
		const seen = new Set(singleFiles.map((e) => e.relativePath));
		for (const entry of entries) {
			if (!seen.has(entry.relativePath)) {
				singleFiles = [...singleFiles, entry];
				seen.add(entry.relativePath);
			}
		}
		filesInputElement.value = '';
	};

	const addResourceDirectory = () => {
		if (!dirInputElement) return;
		const entries = collectFromInput(dirInputElement);
		const seen = new Set(resourceFiles.map((e) => e.relativePath));
		for (const entry of entries) {
			if (!seen.has(entry.relativePath)) {
				resourceFiles = [...resourceFiles, entry];
				seen.add(entry.relativePath);
			}
		}
		dirInputElement.value = '';
	};

	const setBatchFiles = () => {
		if (!batchInputElement) return;
		batchFiles = collectFromInput(batchInputElement);
		batchInputElement.value = '';
	};

	// All files of the current run (single mode: md files + resource directory).
	$: runEntries = mode === 'single' ? [...singleFiles, ...resourceFiles] : batchFiles;
	$: totalFileCount = runEntries.length;
	$: overFileThreshold = totalFileCount > thresholdFileCount;

	// ── Preview ──────────────────────────────────────────────────────────────────

	let existingNotesByTitle = new Map<string, any>();

	const loadExistingNotes = async (): Promise<Map<string, any>> => {
		const byTitle = new Map<string, any>();
		try {
			const notes = await getNotes(localStorage.token, true);
			if (Array.isArray(notes)) {
				for (const note of notes) {
					if (note?.title && !byTitle.has(note.title)) {
						byTitle.set(note.title, note);
					}
				}
			}
		} catch {
			// Conflict detection degrades to "no existing notes" on failure.
		}
		return byTitle;
	};

	const planOf = (flat: boolean) => buildBatchPlan(runEntries, flat);

	const readMarkdownContents = async (
		entries: readonly ImportEntry[],
		plan: ReturnType<typeof buildBatchPlan>
	): Promise<Map<string, string>> => {
		const contents = new Map<string, string>();
		for (const md of plan.markdown) {
			const entry = entries.find((e) => e.relativePath === md.mdPath);
			if (entry) {
				contents.set(md.mdPath, await entry.file.text());
			}
		}
		return contents;
	};

	const startPreview = async () => {
		error = '';
		if (runEntries.length === 0) {
			error = $i18n.t('Select Markdown files or a folder to import first');
			return;
		}

		try {
			existingNotesByTitle = await loadExistingNotes();
			const flat = flatTitles;
			const plan = planOf(flat);

			overThresholdMds = [];
			for (const md of plan.markdown) {
				const entry = runEntries.find((e) => e.relativePath === md.mdPath);
				if (!entry) continue;
				const content = await entry.file.text();
				const refs = parseImageRefs(content).filter((r) => !r.external).length;
				if (refs > thresholdRefCount) {
					overThresholdMds = [...overThresholdMds, { path: md.mdPath, refs }];
				}
			}

			preview = buildImportPreview(
				runEntries.map((e) => ({ relativePath: e.relativePath })),
				{
					existingKeys: existingNotesByTitle,
					// Preview marks conflicts against existing note titles; note titles
					// are path-derived, so the key is the normalized path minus its
					// extension when titles are flat, and the full path otherwise.
					conflictKeyOf: (e: { path: string; filename: string }) =>
						flat ? e.filename.replace(/\.[^./]+$/, '') : e.path.replace(/\.[^./]+$/, ''),
					markdownContents: await readMarkdownContents(runEntries, plan)
				}
			);
			previewTreeLines = renderTreeLines(preview.tree);
			view = 'preview';
		} catch (e) {
			error = extractError(e);
		}
	};

	// ── Execution ────────────────────────────────────────────────────────────────

	const newReport = (m: 'single' | 'batch'): ImportReport => ({
		mode: m,
		started_at: Date.now(),
		cancelled: false,
		totals: {
			markdown: 0,
			created: 0,
			updated: 0,
			copies: 0,
			skipped: 0,
			unchanged: 0,
			failed: 0,
			images_uploaded: 0,
			images_deduped: 0,
			other_docs: 0,
			missing_images: 0,
			orphan_images: 0
		},
		items: [],
		missing_images: [],
		orphans: [],
		invalid_paths: []
	});

	const runImport = async () => {
		if (running || runEntries.length === 0) return;
		running = true;
		cancelRequested = false;
		error = '';
		view = 'running';

		const modeAtStart = mode;
		const strategy = conflictStrategy;
		const flat = modeAtStart === 'batch' ? flatTitles : true;
		const rep = newReport(modeAtStart);

		try {
			const plan = buildBatchPlan(runEntries, flat);
			rep.invalid_paths = plan.invalidPaths;
			rep.totals.markdown = plan.markdown.length;

			existingNotesByTitle = await loadExistingNotes();
			const usedTitles = new Set<string>(); // titles claimed during this run

			const allPaths = [
				...plan.markdown.map((m) => m.mdPath),
				...plan.images.map((i) => i.path),
				...plan.otherDocs.map((d) => d.docPath)
			];

			const entriesByPath = new Map<string, ImportEntry>();
			for (const entry of runEntries) {
				if (!entriesByPath.has(entry.relativePath)) entriesByPath.set(entry.relativePath, entry);
			}

			// Non-.md files become notes only when the user opts in (batch mode).
			const worklist: { kind: 'markdown' | 'other'; path: string; title: string }[] = [
				...plan.markdown.map((m) => ({ kind: 'markdown' as const, path: m.mdPath, title: m.title })),
				...(importOtherDocs && modeAtStart === 'batch'
					? plan.otherDocs.map((d) => ({ kind: 'other' as const, path: d.docPath, title: d.title }))
					: [])
			];
			progress = { done: 0, total: worklist.length, current: '' };

			const assetCache = new Map<string, string>(); // crossBatchAssetKey → fileId
			const pathCache = new Map<string, string>(); // normalized path → fileId

			// Batch by 10 files, checking the cancel flag between batches and
			// between individual items.
			const batchSize = 10;
			for (let i = 0; i < worklist.length; i += batchSize) {
				if (cancelRequested) {
					rep.cancelled = true;
					break;
				}

				for (const job of worklist.slice(i, i + batchSize)) {
					if (cancelRequested) {
						rep.cancelled = true;
						break;
					}

					progress = { ...progress, current: job.path };

					try {
						const result = await importOne({
							kind: job.kind,
							path: job.path,
							title: job.title,
							entriesByPath,
							allPaths,
							assetCache,
							pathCache,
							usedTitles,
							strategy,
							rep
						});
						rep.items.push(result);
						if (result.status === 'created') {
							rep.totals.created += 1;
							usedTitles.add(result.title);
						} else if (result.status === 'updated') {
							rep.totals.updated += 1;
						} else if (result.status === 'copy') {
							rep.totals.copies += 1;
							usedTitles.add(result.title);
						} else if (result.status === 'skipped') {
							rep.totals.skipped += 1;
						} else if (result.status === 'unchanged') {
							rep.totals.unchanged += 1;
						} else {
							rep.totals.failed += 1;
						}
					} catch (e) {
						rep.totals.failed += 1;
						rep.items.push({
							path: job.path,
							title: job.title,
							status: 'failed',
							reason: extractError(e)
						});
					}

					progress = { ...progress, done: progress.done + 1 };
				}
			}

			rep.finished_at = Date.now();
		} catch (e) {
			error = extractError(e);
		} finally {
			running = false;
			report = rep;
			view = 'report';
			if (rep.totals.created + rep.totals.updated + rep.totals.copies > 0) {
				onCompleted();
				toast.success(
					$i18n.t('Imported {{count}} notes', {
						count: rep.totals.created + rep.totals.updated + rep.totals.copies
					})
				);
			}
		}
	};

	type ImportOneArgs = {
		kind: 'markdown' | 'other';
		path: string;
		title: string;
		entriesByPath: Map<string, ImportEntry>;
		allPaths: string[];
		assetCache: Map<string, string>;
		pathCache: Map<string, string>;
		usedTitles: Set<string>;
		strategy: ConflictStrategy;
		rep: ImportReport;
	};

	const importOne = async (args: ImportOneArgs): Promise<ReportItem> => {
		const { kind, path, title, entriesByPath, allPaths, assetCache, pathCache, usedTitles, strategy, rep } =
			args;

		const entry = entriesByPath.get(path);
		if (!entry) {
			return { path, title, status: 'failed', reason: $i18n.t('File is no longer selected') };
		}

		// Idempotency key = title (interface_decisions #9). An in-batch duplicate
		// title behaves like an existing note without import meta.
		const inBatchDuplicate = usedTitles.has(title);
		const existing = inBatchDuplicate ? null : (existingNotesByTitle.get(title) ?? null);
		let targetTitle = title;

		if (existing || inBatchDuplicate) {
			if (kind === 'markdown' && existing && (await existingNoteMatchesHash(existing, entry))) {
				return { path, title, status: 'unchanged', note_id: existing.id };
			}
			if (strategy === 'skip') {
				return {
					path,
					title,
					status: 'skipped',
					reason: $i18n.t('A note with this title already exists')
				};
			}
			if (strategy === 'copy') {
				targetTitle = copyTitle(title, new Set([...existingNotesByTitle.keys(), ...usedTitles]));
			}
		}

		const overwrite = (existing || inBatchDuplicate) && strategy === 'overwrite';

		if (kind === 'other') {
			// Other document file imported as a note linking the uploaded file.
			const fileId = await uploadAsset(entry, assetCache, rep);
			const content = `[${entry.file.name}](data://${fileId})`;
			const meta = markdownImportMeta(path, noteContentHash(content), Date.now());
			const note = await persistNote({
				title: targetTitle,
				content,
				meta,
				existingId: overwrite && existing ? existing.id : null,
				preserveMeta: overwrite && existing ? existing.meta : null
			});
			rep.totals.other_docs += 1;
			return {
				path,
				title: targetTitle,
				status: overwrite ? 'updated' : 'created',
				note_id: note.id
			};
		}

		const content = await entry.file.text();
		const analysis = analyzeMarkdownNote(path, content, allPaths);

		const missingPaths = new Set(analysis.missingRefs.map((m) => m.path));
		for (const m of analysis.missingRefs) {
			rep.missing_images.push({
				md: path,
				path: m.path,
				reason: $i18n.t('File not found in the selected files')
			});
		}

		// Upload referenced images (same-name dir + outside-dir refs) and the
		// same-name directory's orphan images (K17), deduped across the batch.
		const referencedPaths = [
			...analysis.referencedDirImages,
			...analysis.outsideDirRefs.map((r) => r.path)
		];
		for (const imgPath of [...referencedPaths, ...analysis.orphanImages]) {
			if (pathCache.has(imgPath)) continue;
			const imgEntry = entriesByPath.get(imgPath);
			if (!imgEntry) continue;
			const fileId = await uploadAsset(imgEntry, assetCache, rep);
			pathCache.set(imgPath, fileId);
			if (analysis.orphanImages.includes(imgPath)) {
				rep.totals.orphan_images += 1;
				rep.orphans.push({ md: path, path: imgPath, file_id: fileId });
			}
		}

		// Rewrite the body: data://<fileId> for uploaded images, keep + a visible
		// warning for missing ones, keep external references as-is.
		const { content: rewritten } = rewriteImageRefs(
			content,
			(ref, normalizedPath) => {
				if (ref.external) return null;
				if (normalizedPath && pathCache.has(normalizedPath)) {
					return { form: 'url', url: `data://${pathCache.get(normalizedPath)}` };
				}
				if (normalizedPath && missingPaths.has(normalizedPath)) {
					return {
						form: 'text',
						text: `${ref.raw}\n> ⚠️ ${$i18n.t('Missing image')}: \`${normalizedPath}\``
					};
				}
				return null;
			},
			{ mdDir: analysis.mdDir }
		);

		const meta = markdownImportMeta(path, noteContentHash(content), Date.now());
		if (pathCache.size > 0) {
			meta.markdown_import.file_ids = Object.fromEntries(
				[...referencedPaths, ...analysis.orphanImages]
					.map((p) => [p, pathCache.get(p)] as const)
					.filter(([, id]) => id !== undefined) as [string, string][]
			);
		}

		const note = await persistNote({
			title: targetTitle,
			content: rewritten,
			meta,
			existingId: overwrite && existing ? existing.id : null,
			preserveMeta: overwrite && existing ? existing.meta : null
		});

		return {
			path,
			title: targetTitle,
			status: overwrite ? 'updated' : existing || inBatchDuplicate ? 'copy' : 'created',
			note_id: note.id
		};
	};

	/**
	 * True when the existing note was created by this importer from identical
	 * Markdown content (same source hash in meta) — the re-import then skips.
	 */
	const existingNoteMatchesHash = async (existing: any, entry: ImportEntry): Promise<boolean> => {
		const hash = existing?.meta?.markdown_import?.content_hash;
		if (!hash) return false;
		const content = await entry.file.text();
		return noteContentHash(content) === hash;
	};

	const persistNote = async ({
		title,
		content,
		meta,
		existingId,
		preserveMeta
	}: {
		title: string;
		content: string;
		meta: any;
		existingId: string | null;
		preserveMeta: any | null;
	}) => {
		const data = {
			content: {
				json: null,
				html: marked.parse(content ?? ''),
				md: content
			}
		};

		if (existingId) {
			const updated = await updateNoteById(localStorage.token, existingId, {
				title,
				data,
				meta: { ...(preserveMeta ?? {}), ...meta }
			});
			if (!updated) throw new Error($i18n.t('Failed to update note'));
			return updated;
		}

		const created = await createNewNote(localStorage.token, {
			title,
			data,
			meta,
			access_grants: []
		});
		if (!created) throw new Error($i18n.t('Failed to create note'));
		return created;
	};

	const uploadAsset = async (
		entry: ImportEntry,
		assetCache: Map<string, string>,
		rep: ImportReport
	): Promise<string> => {
		const hash = await computeFileHash(entry.file);
		const key = crossBatchAssetKey(entry.file.name, entry.file.size, hash);
		const cached = assetCache.get(key);
		if (cached) {
			rep.totals.images_deduped += 1;
			return cached;
		}

		const res = await uploadFile(localStorage.token, entry.file, null, false, false);
		if (!res || !res.id || res.error) {
			throw new Error(res?.error ?? $i18n.t('Failed to upload file'));
		}
		assetCache.set(key, res.id);
		rep.totals.images_uploaded += 1;
		return res.id;
	};

	const statusLabel = (status: ReportItem['status']): string => {
		switch (status) {
			case 'created':
				return $i18n.t('Created');
			case 'updated':
				return $i18n.t('Updated');
			case 'copy':
				return $i18n.t('Imported as a copy');
			case 'skipped':
				return $i18n.t('Skipped');
			case 'unchanged':
				return $i18n.t('Unchanged');
			default:
				return $i18n.t('Failed');
		}
	};

	const fmtTime = (ts?: number) => (ts ? new Date(ts).toLocaleString() : '');
</script>

<Modal bind:show size="md">
	<div class="flex flex-col gap-3">
		<div class="flex items-center justify-between gap-2">
			<div class="text-lg font-medium">{$i18n.t('Import Markdown notes')}</div>
			{#if view === 'report' && report}
				<button
					data-testid="import-notes-new"
					class="text-xs px-2 py-1 rounded-lg bg-gray-100 dark:bg-gray-850 hover:bg-gray-200/60 dark:hover:bg-gray-800 transition"
					on:click={openSelect}>{$i18n.t('New import')}</button
				>
			{/if}
		</div>

		{#if error}
			<div role="alert" class="rounded-xl bg-red-500/10 p-3 text-sm break-words">{error}</div>
		{/if}

		{#if view === 'select'}
			<div class="flex gap-2">
				<button
					class="flex-1 text-sm px-3 py-2 rounded-xl border transition {mode === 'single'
						? 'border-gray-800 dark:border-gray-200'
						: 'border-gray-200 dark:border-gray-800'}"
					on:click={() => {
						mode = 'single';
						clearAll();
					}}
				>
					{$i18n.t('Single files')}
					<div class="mt-0.5 text-xs font-normal text-gray-500">
						{$i18n.t('Markdown files + optional same-name asset directory')}
					</div>
				</button>
				<button
					class="flex-1 text-sm px-3 py-2 rounded-xl border transition {mode === 'batch'
						? 'border-gray-800 dark:border-gray-200'
						: 'border-gray-200 dark:border-gray-800'}"
					on:click={() => {
						mode = 'batch';
						clearAll();
					}}
				>
					{$i18n.t('Batch folder')}
					<div class="mt-0.5 text-xs font-normal text-gray-500">
						{$i18n.t('Import a whole folder as hierarchical notes')}
					</div>
				</button>
			</div>

			{#if mode === 'single'}
				<div class="flex flex-col gap-2">
					<div class="flex flex-wrap gap-2">
						<button
							class="text-sm px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-850 hover:bg-gray-200/60 dark:hover:bg-gray-800 transition"
							on:click={() => filesInputElement?.click()}
						>
							{$i18n.t('Select Markdown files')}
						</button>
						<button
							class="text-sm px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-850 hover:bg-gray-200/60 dark:hover:bg-gray-800 transition"
							on:click={() => dirInputElement?.click()}
						>
							{$i18n.t('Add resource directory (optional)')}
						</button>
					</div>
					<div class="text-xs text-gray-500">
						{$i18n.t('A directory named like a .md file is treated as that note\'s image directory')}
					</div>

					{#if singleFiles.length > 0}
						<div class="text-xs text-gray-500">
							{$i18n.t('Markdown files')}: {singleFiles.length}
						</div>
						<div
							class="flex max-h-32 flex-col gap-1 overflow-y-auto rounded-xl bg-gray-50 p-2 text-xs dark:bg-gray-850"
						>
							{#each singleFiles as entry (entry.relativePath)}
								<div class="flex items-center justify-between gap-2">
									<span class="truncate">{entry.relativePath}</span>
									<button
										class="shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
										aria-label={$i18n.t('Remove')}
										on:click={() => (singleFiles = singleFiles.filter((e) => e !== entry))}
									>✕</button
									>
								</div>
							{/each}
						</div>
					{/if}
					{#if resourceFiles.length > 0}
						<div class="text-xs text-gray-500">
							{$i18n.t('Resource files')}: {resourceFiles.length}
							<button
								class="ml-2 underline"
								on:click={() => (resourceFiles = [])}>{$i18n.t('Clear')}</button
							>
						</div>
					{/if}
				</div>
			{:else}
				<div class="flex flex-col gap-2">
					<button
						class="self-start text-sm px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-850 hover:bg-gray-200/60 dark:hover:bg-gray-800 transition"
						on:click={() => batchInputElement?.click()}
					>
						{$i18n.t('Select folder')}
					</button>
					{#if batchFiles.length > 0}
						<div class="text-xs text-gray-500">
							{$i18n.t('Collected files')}: {batchFiles.length}
						</div>
					{/if}

					<div class="flex flex-col gap-1 text-sm">
						<div class="text-xs font-medium text-gray-500 dark:text-gray-400">
							{$i18n.t('Note titles')}
						</div>
						<label class="flex items-center gap-2">
							<input type="radio" bind:group={flatTitles} value={false} />
							{$i18n.t('Keep directory hierarchy (path prefix + file name)')}
						</label>
						<label class="flex items-center gap-2">
							<input type="radio" bind:group={flatTitles} value={true} />
							{$i18n.t('Flatten into one level (file name only)')}
						</label>
					</div>
				</div>
			{/if}

			{#if overThresholdMds.length > 0}
				<div class="rounded-xl bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
					{$i18n.t('Some files reference more than 50 images and may take a while to import')}:
					{#each overThresholdMds as item (item.path)}
						<div class="truncate">{item.path} ({item.refs})</div>
					{/each}
				</div>
			{/if}
			{#if overFileThreshold}
				<div class="rounded-xl bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
					{$i18n.t('More than 500 files selected — consider importing in smaller batches')}
				</div>
			{/if}

			<div class="flex items-center justify-end gap-2 pt-1">
				<button
					data-testid="import-notes-start"
					class="flex items-center gap-1.5 rounded-lg bg-black px-3 py-1.5 text-sm text-white transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-black"
					disabled={runEntries.length === 0 || running}
					on:click={() => (mode === 'batch' ? startPreview() : runImport())}
				>
					{mode === 'batch' ? $i18n.t('Preview import') : $i18n.t('Import')}
				</button>
			</div>
		{:else if view === 'preview' && preview}
			<div class="flex flex-wrap gap-2 text-sm">
				<div class="rounded-xl bg-gray-50 px-3 py-2 dark:bg-gray-850">
					{$i18n.t('Markdown files')}: <b>{preview.markdownCount}</b>
				</div>
				<div class="rounded-xl bg-gray-50 px-3 py-2">
					{$i18n.t('Images')}: <b>{preview.imageCount}</b>
				</div>
				<div class="rounded-xl bg-gray-50 px-3 py-2">
					{$i18n.t('Orphan images')}: <b>{preview.orphanImageCount}</b>
				</div>
				<div class="rounded-xl bg-gray-50 px-3 py-2">
					{$i18n.t('Conflicts')}: <b>{preview.conflicts.length}</b>
				</div>
			</div>

			{#if preview.invalidPaths.length > 0}
				<div class="rounded-xl bg-amber-500/10 p-3 text-sm">
					{$i18n.t('Invalid paths are skipped')}:
					{#each preview.invalidPaths as p (p.relativePath)}
						<div class="truncate">{p.relativePath} — {p.reason}</div>
					{/each}
				</div>
			{/if}

			{#if previewTreeLines.length > 0}
				<div
					class="max-h-48 overflow-y-auto whitespace-pre rounded-xl bg-gray-50 p-2 font-mono text-xs dark:bg-gray-850"
				>
					{previewTreeLines.join('\n')}{previewTreeLines.length >= 200 ? `\n… ${$i18n.t('and more')}` : ''}
				</div>
			{/if}

			{#if preview.conflicts.length > 0}
				<div class="flex flex-col gap-1 text-sm">
					<div class="text-xs font-medium text-gray-500 dark:text-gray-400">
						{$i18n.t('Conflict strategy')}
					</div>
					{#each [
							{ value: 'skip', label: $i18n.t('Skip (default)') },
							{ value: 'overwrite', label: $i18n.t('Overwrite') },
							{ value: 'copy', label: $i18n.t('Create a copy') }
						] as option (option.value)}
						<label class="flex items-center gap-2">
							<input type="radio" bind:group={conflictStrategy} value={option.value} />
							{option.label}
						</label>
					{/each}
				</div>
			{/if}

			<label class="flex items-center gap-2 text-sm">
				<input type="checkbox" bind:checked={importOtherDocs} />
				{$i18n.t('Also import other document files as notes')}
			</label>

			<div class="flex items-center justify-end gap-2 pt-1">
				<button
					class="rounded-lg bg-gray-100 px-3 py-1.5 text-sm transition hover:bg-gray-200/60 dark:bg-gray-850 dark:hover:bg-gray-800"
					on:click={openSelect}>{$i18n.t('Back')}</button
				>
				<button
					data-testid="import-notes-confirm"
					class="rounded-lg bg-black px-3 py-1.5 text-sm text-white transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-black"
					on:click={runImport}
				>
					{$i18n.t('Import')}
				</button>
			</div>
		{:else if view === 'running'}
			<div class="flex flex-col gap-2 py-4">
				<div class="flex items-center gap-2">
					<Spinner className="size-4" />
					<div class="min-w-0 text-sm">
						{progress.done} / {progress.total}
						{#if progress.current}
							<span class="ml-2 truncate text-gray-500">{progress.current}</span>
						{/if}
					</div>
				</div>
				<div class="h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-850">
					<div
						class="h-full bg-black transition-all dark:bg-white"
						style="width: {progress.total === 0
							? 0
							: Math.round((progress.done / progress.total) * 100)}%"
					></div>
				</div>
				<button
					class="self-start rounded-lg bg-gray-100 px-3 py-1.5 text-sm transition hover:bg-gray-200/60 dark:bg-gray-850 dark:hover:bg-gray-800"
					disabled={cancelRequested}
					on:click={() => (cancelRequested = true)}
				>
					{cancelRequested ? $i18n.t('Cancelling...') : $i18n.t('Cancel')}
				</button>
			</div>
		{:else if view === 'report' && report}
			<div class="flex flex-col gap-2 text-sm">
				<div class="flex flex-wrap gap-2">
					<span class="rounded-full bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-850">
						{$i18n.t('Created')}: {report.totals.created}
					</span>
					<span class="rounded-full bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-850">
						{$i18n.t('Updated')}: {report.totals.updated}
					</span>
					{#if report.totals.copies > 0}
						<span class="rounded-full bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-850">
							{$i18n.t('Copies')}: {report.totals.copies}
						</span>
					{/if}
					<span class="rounded-full bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-850">
						{$i18n.t('Skipped')}: {report.totals.skipped}
					</span>
					<span class="rounded-full bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-850">
						{$i18n.t('Unchanged')}: {report.totals.unchanged}
					</span>
					<span class="rounded-full bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-850">
						{$i18n.t('Failed')}: {report.totals.failed}
					</span>
					<span class="rounded-full bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-850">
						{$i18n.t('Images uploaded')}: {report.totals.images_uploaded} (+{$i18n.t('deduped')}
						{report.totals.images_deduped})
					</span>
					<span class="rounded-full bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-850">
						{$i18n.t('Orphan images')}: {report.totals.orphan_images}
					</span>
					<span class="rounded-full bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-850">
						{$i18n.t('Missing images')}: {report.totals.missing_images}
					</span>
				</div>

				{#if report.cancelled}
					<div class="rounded-xl bg-amber-500/10 p-2 text-sm">
						{$i18n.t('Import was cancelled — completed notes are kept and a re-run skips them automatically')}
					</div>
				{/if}

				{#if report.missing_images.length > 0}
					<div class="max-h-32 overflow-y-auto rounded-xl bg-red-500/10 p-2 text-xs">
						<div class="mb-1 font-medium">{$i18n.t('Missing images')}</div>
						{#each report.missing_images as m, i (`${m.md}:${m.path}:${i}`)}
							<div class="truncate">{m.md} → {m.path}</div>
						{/each}
					</div>
				{/if}

				{#if report.items.length > 0}
					<div
						class="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-xl bg-gray-50 p-2 text-xs dark:bg-gray-850"
					>
						{#each report.items as item, i (`${item.path}:${i}`)}
							<div class="flex items-center justify-between gap-2">
								<span class="min-w-0 truncate">{item.path}</span>
								<span
									class="shrink-0 rounded-full px-2 py-0.5 {item.status === 'failed'
										? 'bg-red-500/10 text-red-600 dark:text-red-400'
										: item.status === 'skipped' || item.status === 'unchanged'
											? 'bg-gray-200/60 text-gray-500 dark:bg-gray-800'
											: 'bg-green-500/10 text-green-600 dark:text-green-400'}"
									title={item.reason ?? ''}
								>
									{statusLabel(item.status)}
								</span>
							</div>
						{/each}
					</div>
				{/if}

				<div class="text-xs text-gray-500">{fmtTime(report.finished_at)}</div>
			</div>
		{/if}
	</div>
</Modal>

<!-- hidden pickers -->
<input
	bind:this={filesInputElement}
	type="file"
	accept=".md,.markdown,.txt,.png,.jpg,.jpeg,.gif,.webp,.svg,.bmp,image/*"
	multiple
	hidden
	on:change={addSingleFiles}
/>
<input bind:this={dirInputElement} type="file" webkitdirectory directory multiple hidden on:change={addResourceDirectory} />
<input bind:this={batchInputElement} type="file" webkitdirectory directory multiple hidden on:change={setBatchFiles} />
