<script lang="ts">
	import { getContext, onDestroy, tick } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { v4 as uuidv4 } from 'uuid';
	import { mobile } from '$lib/stores';
	import MistDrawer from '$lib/components/mist/MistDrawer.svelte';
	import CropEditor from '$lib/components/appearance/CropEditor.svelte';
	import InterfacePreview from '$lib/components/appearance/InterfacePreview.svelte';
	import {
		APPEARANCE_PRESETS,
		applyPreset,
		beginAppearancePreview,
		cloneAppearance,
		endAppearancePreview,
		normalizeAppearance,
		parseThemeFile,
		persistAppearanceChange,
		presetName,
		serializeThemeFile,
		suggestColorsFromImage,
		processWallpaperFile,
		resolveAppearanceTheme,
		updateAppearancePreview,
		appearancePreviewTheme,
		appearancePreviewWallpaperUrl,
		appearanceSettings,
		resolvedAppearanceTheme,
		systemPrefersDark,
		themeColorTokens,
		loadWallpaperAsset,
		listWallpaperAssets,
		deleteWallpaperAsset,
		contrastRatio,
		type AppearancePreset,
		type AppearanceSettings,
		type AppearanceTheme,
		type GradientId,
		type ResolvedAppearanceTheme,
		type SurfaceSlot
	} from '$lib/appearance';
	import { GRADIENT_IDS } from '$lib/appearance/schema';

	type Props = {
		open: boolean;
		onclose: () => void;
	};

	let { open, onclose }: Props = $props();
	const i18n = getContext<any>('i18n');
	const zh = $derived(
		String($i18n.language ?? '')
			.toLowerCase()
			.startsWith('zh')
	);
	const copy = (chinese: string, english: string) => (zh ? chinese : english);

	let draft = $state<AppearanceSettings>(structuredClone($appearanceSettings));
	let editorMode = $state<ResolvedAppearanceTheme>('light');
	let busy = $state(false);
	let fileInput: HTMLInputElement | null = $state(null);
	let importInput: HTMLInputElement | null = $state(null);
	let pendingBlobs: Record<string, Blob> = {};
	let previewUrls = $state<Partial<Record<ResolvedAppearanceTheme, string>>>({});
	let library: { id: string; url: string }[] = $state([]);
	let initializedOpen = false;
	let previewGeneration = 0;
	let collapsed = $state(false);

	const currentMode = $derived(draft.modes[editorMode]);
	const currentBackground = $derived(currentMode.background);
	const previewWallpaperUrl = $derived(
		currentBackground.kind === 'local-image'
			? (library.find((item) => item.id === currentBackground.assetId)?.url ??
					previewUrls[editorMode] ??
					null)
			: null
	);
	const tokens = $derived(themeColorTokens(currentMode.colors));
	const contrastReadable = (foreground: string, background: string) =>
		`${contrastRatio(foreground, background).toFixed(1)}:1`;
	const modeLabel = (mode: ResolvedAppearanceTheme) =>
		mode === 'light' ? copy('浅色', 'Light') : copy('深色', 'Dark');

	$effect(() => {
		if (open && !initializedOpen) {
			initializedOpen = true;
			collapsed = false;
			draft = cloneAppearance($appearanceSettings);
			editorMode = $resolvedAppearanceTheme;
			beginAppearancePreview(
				draft,
				previewUrls[editorMode] ?? null,
				draft.theme === 'system' ? null : editorMode
			);
			void syncWallpaperPreview(editorMode);
			void refreshLibrary();
		} else if (!open) {
			initializedOpen = false;
			previewGeneration += 1;
		}
	});

	$effect(() => {
		if (!open) return;
		updateAppearancePreview(draft);
	});

	onDestroy(() => {
		cleanupPreviewUrls();
		endAppearancePreview();
	});

	function cleanupPreviewUrls() {
		previewGeneration += 1;
		for (const url of Object.values(previewUrls)) {
			if (url) URL.revokeObjectURL(url);
		}
		previewUrls = {};
		pendingBlobs = {};
	}

	async function syncWallpaperPreview(mode: ResolvedAppearanceTheme) {
		const generation = ++previewGeneration;
		const background = draft.modes[mode].background;
		if (background.kind !== 'local-image') {
			const previousUrl = previewUrls[mode];
			if (previousUrl) URL.revokeObjectURL(previousUrl);
			delete previewUrls[mode];
			if (editorMode === mode) appearancePreviewWallpaperUrl.set(null);
			return;
		}

		let blob: Blob | null = pendingBlobs[background.assetId] ?? null;
		if (!blob) {
			blob = await loadWallpaperAsset(background.assetId).catch(() => null);
		}
		const latestBackground = draft.modes[mode].background;
		if (
			generation !== previewGeneration ||
			!blob ||
			latestBackground.kind !== 'local-image' ||
			latestBackground.assetId !== background.assetId
		) {
			return;
		}

		const previousUrl = previewUrls[mode];
		if (previousUrl) URL.revokeObjectURL(previousUrl);
		const objectUrl = URL.createObjectURL(blob);
		previewUrls[mode] = objectUrl;
		if (editorMode === mode) appearancePreviewWallpaperUrl.set(objectUrl);
	}

	function updateDraft(next: AppearanceSettings) {
		draft = next;
	}

	function setPreset(preset: AppearancePreset) {
		updateDraft(applyPreset(draft, preset));
	}

	function setModeColors(
		key: keyof AppearanceSettings['modes']['light']['colors'],
		value: string | number
	) {
		const mode = editorMode;
		updateDraft({
			...draft,
			modes: {
				...draft.modes,
				[mode]: {
					...draft.modes[mode],
					colors: { ...draft.modes[mode].colors, [key]: value }
				}
			}
		});
	}

	function setBackground(next: AppearanceSettings['modes']['light']['background']) {
		const mode = editorMode;
		updateDraft({
			...draft,
			modes: {
				...draft.modes,
				[mode]: { ...draft.modes[mode], background: next }
			}
		});
	}

	function setGlass(key: keyof AppearanceSettings['glass'], value: number) {
		updateDraft({ ...draft, glass: { ...draft.glass, [key]: value } });
	}

	function setLayoutGroup<Key extends keyof AppearanceSettings['layout']>(
		group: Key,
		key: keyof AppearanceSettings['layout'][Key],
		value: unknown
	) {
		updateDraft({
			...draft,
			layout: {
				...draft.layout,
				[group]: { ...draft.layout[group], [key]: value }
			}
		});
	}

	function setReading<Key extends keyof AppearanceSettings['reading']>(
		key: Key,
		value: AppearanceSettings['reading'][Key]
	) {
		updateDraft({ ...draft, reading: { ...draft.reading, [key]: value } });
	}

	function setOverride(slot: SurfaceSlot, key: string, value: number | null) {
		const components = { ...draft.components };
		const override = { ...(components[slot] ?? {}) } as Record<string, number>;
		if (value === null) delete override[key];
		else override[key] = value;
		if (Object.keys(override).length) components[slot] = override;
		else delete components[slot];
		updateDraft({ ...draft, components });
	}

	function switchEditorMode(mode: ResolvedAppearanceTheme) {
		editorMode = mode;
		appearancePreviewTheme.set(mode);
		appearancePreviewWallpaperUrl.set(previewUrls[mode] ?? null);
		void syncWallpaperPreview(mode);
	}

	function setThemeMode(theme: AppearanceTheme) {
		draft = { ...draft, theme };
		const mode = theme === 'system' ? resolveAppearanceTheme(theme, $systemPrefersDark) : theme;
		editorMode = mode;
		appearancePreviewTheme.set(theme === 'system' ? null : mode);
		appearancePreviewWallpaperUrl.set(previewUrls[mode] ?? null);
		void syncWallpaperPreview(mode);
	}

	function handleDrawerClose() {
		cancelChanges();
	}

	async function chooseWallpaper(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		busy = true;
		try {
			const blob = await processWallpaperFile(file);
			const assetId = uuidv4();
			pendingBlobs[assetId] = blob;
			addToLibrary(assetId, blob);
			activateWallpaper(assetId, blob);
			toast.success(copy('背景图片已载入预览', 'Wallpaper loaded into the preview'));
		} catch (error) {
			toast.error(
				error instanceof Error
					? error.message
					: copy('无法处理这张图片', 'The image could not be processed')
			);
		} finally {
			busy = false;
		}
	}

	function addToLibrary(assetId: string, blob: Blob) {
		const url = URL.createObjectURL(blob);
		library = [{ id: assetId, url }, ...library.filter((item) => item.id !== assetId)];
	}

	async function refreshLibrary() {
		try {
			const metas = await listWallpaperAssets();
			const items: { id: string; url: string }[] = [];
			for (const meta of metas) {
				const existing = library.find((item) => item.id === meta.id);
				if (existing) {
					items.push(existing);
					continue;
				}
				const blob = pendingBlobs[meta.id] ?? (await loadWallpaperAsset(meta.id).catch(() => null));
				if (blob) items.push({ id: meta.id, url: URL.createObjectURL(blob) });
			}
			for (const item of library) {
				if (!items.some((next) => next.id === item.id)) URL.revokeObjectURL(item.url);
			}
			library = items;
		} catch {
			// Library is best-effort; the active background preview still works.
		}
	}

	function activateWallpaper(assetId: string, blob: Blob | null) {
		previewGeneration += 1;
		const previousUrl = previewUrls[editorMode];
		if (previousUrl && !library.some((item) => item.url === previousUrl)) {
			URL.revokeObjectURL(previousUrl);
		}
		const libraryUrl = library.find((item) => item.id === assetId)?.url ?? null;
		const objectUrl = libraryUrl ?? (blob ? URL.createObjectURL(blob) : null);
		if (!objectUrl) return;
		previewUrls[editorMode] = objectUrl;
		appearancePreviewWallpaperUrl.set(objectUrl);
		const background = currentBackground.kind === 'local-image' ? currentBackground : null;
		setBackground({
			kind: 'local-image',
			assetId,
			crop: background?.crop ?? { x: 0, y: 0, width: 1, height: 1 },
			scale: background?.scale ?? 100,
			mask: currentBackground.mask,
			blur: currentBackground.blur
		});
	}

	async function selectLibraryImage(assetId: string) {
		const blob = pendingBlobs[assetId] ?? (await loadWallpaperAsset(assetId).catch(() => null));
		if (!blob) {
			toast.error(copy('找不到这张图片', 'The image asset is unavailable'));
			return;
		}
		activateWallpaper(assetId, blob);
	}

	async function removeLibraryImage(assetId: string) {
		const inUse = [draft.modes.light.background, draft.modes.dark.background].some(
			(background) => background.kind === 'local-image' && background.assetId === assetId
		);
		if (inUse) {
			toast.info(copy('这张图正在作为背景使用', 'This image is the active background'));
			return;
		}
		await deleteWallpaperAsset(assetId).catch(() => undefined);
		delete pendingBlobs[assetId];
		const item = library.find((entry) => entry.id === assetId);
		if (item) URL.revokeObjectURL(item.url);
		library = library.filter((entry) => entry.id !== assetId);
		toast.success(copy('已从图库删除', 'Removed from the library'));
	}

	async function useImageColors() {
		const background = currentBackground;
		if (background.kind !== 'local-image') {
			toast.info(copy('请先选择一张本地图片', 'Choose a local image first'));
			return;
		}
		const blob = pendingBlobs[background.assetId] ?? (await loadWallpaperAsset(background.assetId));
		if (!blob) {
			toast.error(copy('找不到这张图片', 'The image asset is unavailable'));
			return;
		}
		try {
			const colors = await suggestColorsFromImage(blob, editorMode);
			updateDraft({
				...draft,
				modes: {
					...draft.modes,
					[editorMode]: {
						...draft.modes[editorMode],
						colors: { ...draft.modes[editorMode].colors, ...colors }
					}
				}
			});
			toast.success(copy('已从图片提取配色', 'Colors sampled from the image'));
		} catch {
			toast.error(copy('无法从图片取色', 'Could not sample colors from this image'));
		}
	}

	async function applyChanges() {
		busy = true;
		try {
			const previous = $appearanceSettings;
			const saved = await persistAppearanceChange({
				origin: window.location.origin,
				draft,
				previous,
				pendingBlobs
			});
			appearanceSettings.set(saved);
			cleanupPreviewUrls();
			endAppearancePreview();
			toast.success(copy('外观设置已应用', 'Appearance settings applied'));
			onclose();
		} catch (error) {
			toast.error(
				error instanceof Error
					? error.message
					: copy('保存外观设置失败', 'Could not save appearance settings')
			);
		} finally {
			busy = false;
		}
	}

	function cancelChanges() {
		cleanupPreviewUrls();
		endAppearancePreview();
		onclose();
	}

	function resetGroup(group: string) {
		const defaults = normalizeAppearance({ preset: draft.preset });
		if (group === 'background') {
			setBackground(defaults.modes[editorMode].background);
			if (previewUrls[editorMode]) {
				URL.revokeObjectURL(previewUrls[editorMode]!);
				delete previewUrls[editorMode];
				appearancePreviewWallpaperUrl.set(null);
			}
			return;
		}
		if (group === 'colors') {
			updateDraft({
				...draft,
				modes: {
					...draft.modes,
					[editorMode]: {
						...draft.modes[editorMode],
						colors: defaults.modes[editorMode].colors
					}
				}
			});
			return;
		}
		if (group === 'materials') {
			updateDraft({ ...draft, glass: defaults.glass, components: {} });
			return;
		}
		if (group === 'navigation') {
			updateDraft({
				...draft,
				layout: { ...draft.layout, navigation: defaults.layout.navigation }
			});
			return;
		}
		if (group === 'messages') {
			updateDraft({
				...draft,
				layout: {
					...draft.layout,
					userMessage: defaults.layout.userMessage,
					assistantMessage: defaults.layout.assistantMessage,
					composer: defaults.layout.composer
				},
				components: {
					...draft.components,
					userMessage: undefined,
					assistantMessage: undefined,
					composer: undefined
				}
			});
			return;
		}
		if (group === 'overlays') {
			updateDraft({
				...draft,
				glass: { ...draft.glass, overlayScrim: defaults.glass.overlayScrim },
				components: {
					...draft.components,
					navigation: undefined,
					overlay: undefined,
					reading: undefined
				}
			});
			return;
		}
		if (group === 'reading') {
			updateDraft({ ...draft, reading: defaults.reading });
			return;
		}
		updateDraft({ ...draft, motion: defaults.motion });
	}

	function restoreAll() {
		const question = copy(
			'恢复全部外观默认值？当前尚未应用的调整会丢失。',
			'Restore every appearance default? Pending changes will be lost.'
		);
		if (!window.confirm(question)) return;
		draft = structuredClone(normalizeAppearance({ preset: 'mist-blue' }));
		cleanupPreviewUrls();
		appearancePreviewWallpaperUrl.set(null);
		appearancePreviewTheme.set(editorMode);
	}

	function exportTheme() {
		const blob = new Blob([serializeThemeFile(draft)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = `open-webui-mist-${draft.preset}.json`;
		anchor.click();
		URL.revokeObjectURL(url);
	}

	async function importTheme(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		try {
			const imported = parseThemeFile(await file.text(), draft);
			draft = imported;
			updateAppearancePreview(imported);
			toast.success(copy('主题已载入预览，点击应用后保存', 'Theme loaded into the preview'));
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : copy('主题文件无效', 'The theme file is invalid')
			);
		}
	}

	function overrideValue(slot: SurfaceSlot, key: string): number | null {
		const value = (draft.components[slot] as Record<string, number> | undefined)?.[key];
		return typeof value === 'number' ? value : null;
	}
</script>

{#snippet toggle(
	label: string,
	description: string,
	checked: boolean,
	onchange: (checked: boolean) => void
)}
	<label class="mist-editor-row mist-editor-row--toggle">
		<span>
			<strong>{label}</strong>
			<small>{description}</small>
		</span>
		<input
			class="mist-editor-switch"
			type="checkbox"
			{checked}
			onchange={(event) => onchange(event.currentTarget.checked)}
		/>
	</label>
{/snippet}

{#snippet selectRow(
	label: string,
	value: string | number,
	options: Array<{ value: string | number; label: string }>,
	onchange: (value: string) => void
)}
	<label class="mist-editor-field">
		<span>{label}</span>
		<select value={String(value)} onchange={(event) => onchange(event.currentTarget.value)}>
			{#each options as option}
				<option value={String(option.value)}>{option.label}</option>
			{/each}
		</select>
	</label>
{/snippet}

{#snippet rangeRow(
	label: string,
	value: number,
	min: number,
	max: number,
	step: number,
	suffix: string,
	oninput: (value: number) => void
)}
	<label class="mist-editor-range">
		<span>{label}<b>{value}{suffix}</b></span>
		<input
			type="range"
			{min}
			{max}
			{step}
			{value}
			oninput={(event) => oninput(Number(event.currentTarget.value))}
		/>
	</label>
{/snippet}

{#snippet colourRow(label: string, value: string, oninput: (value: string) => void)}
	<label class="mist-editor-colour">
		<span>{label}</span>
		<span class="mist-editor-colour__control">
			<input type="color" {value} oninput={(event) => oninput(event.currentTarget.value)} />
			<code>{value.toUpperCase()}</code>
		</span>
	</label>
{/snippet}

{#snippet overrideRow(
	slot: SurfaceSlot,
	key: string,
	label: string,
	min: number,
	max: number,
	fallback: number,
	unit: string
)}
	{@const value = overrideValue(slot, key)}
	<label class="mist-editor-override">
		<span>{label}</span>
		<input
			type="number"
			{min}
			{max}
			value={value ?? ''}
			placeholder={`${fallback}${unit}`}
			oninput={(event) => {
				const inputValue = event.currentTarget.value;
				setOverride(slot, key, inputValue === '' ? null : Number(inputValue));
			}}
		/>
		<button
			type="button"
			disabled={value === null}
			title={copy('恢复继承', 'Inherit global value')}
			onclick={() => setOverride(slot, key, null)}
		>
			↺
		</button>
	</label>
{/snippet}

<MistDrawer
	{open}
	side={$mobile ? 'bottom' : 'right'}
	title={copy('外观与阅读', 'Appearance & reading')}
	preview={true}
	compact={collapsed}
	hidden={collapsed}
	onclose={handleDrawerClose}
>
	<div class="mist-editor-status" aria-live="polite">
		<span class="mist-editor-status__dot"></span>
		<span>{copy('实时预览中', 'Live preview')}</span>
		<span class="mist-editor-status__swatch" style:background={tokens.accent}></span>
		<span>{presetName(draft.preset, String($i18n.language ?? 'en'))}</span>
		<button
			type="button"
			class="mist-editor-collapse"
			onclick={() => (collapsed = true)}
			aria-label={copy('收起面板', 'Collapse panel')}
		>
			{copy('收起', 'Hide')}
		</button>
	</div>

	{#snippet footer()}
		<button
			class="mist-button mist-button--ghost"
			type="button"
			disabled={busy}
			onclick={restoreAll}
		>
			{copy('恢复全部', 'Reset all')}
		</button>
		<div class="mist-editor-footer-spacer"></div>
		<button class="mist-button mist-button--ghost" type="button" onclick={cancelChanges}>
			{copy('取消', 'Cancel')}
		</button>
		<button
			class="mist-button mist-button--primary"
			type="button"
			disabled={busy}
			onclick={applyChanges}
		>
			{busy ? copy('处理中…', 'Working…') : copy('应用', 'Apply')}
		</button>
	{/snippet}

	<section class="mist-editor-summary">
		<div>
			<h3>{copy('一套外观，覆盖全部页面', 'One appearance across every page')}</h3>
			<p>
				{copy(
					'设置仅保存在当前设备和服务地址中。正文颜色会自动保证可读对比。',
					'Settings stay on this device and service origin. Body text contrast is generated automatically.'
				)}
			</p>
		</div>
		<div class="mist-editor-summary__toggles">
			{@render toggle(
				copy('启用 Mist Glass', 'Enable Mist Glass'),
				copy('关闭后保留配置', 'Your configuration is kept when disabled'),
				draft.enabled,
				(value) => (draft = { ...draft, enabled: value })
			)}
			{@render toggle(
				copy('启用对话目录', 'Enable conversation navigator'),
				copy('只索引已经加载的消息', 'Only loaded messages are indexed'),
				draft.directoryEnabled,
				(value) => (draft = { ...draft, directoryEnabled: value })
			)}
		</div>
	</section>

	<details class="mist-editor-group" open>
		<summary>
			<span><b>01</b>{copy('预设', 'Presets')}</span>
			<small
				>{copy('保留布局、阅读和组件覆盖', 'Keeps layout, reading and component overrides')}</small
			>
		</summary>
		<div class="mist-preset-grid">
			{#each APPEARANCE_PRESETS as preset}
				<button
					type="button"
					class="mist-preset"
					data-active={draft.preset === preset.id}
					onclick={() => setPreset(preset.id)}
				>
					<span
						class="mist-preset__swatch"
						style:--preset-light={preset.id === 'midnight' ? '#101827' : '#e8f1fa'}
						data-preset={preset.id}
					></span>
					<strong>{presetName(preset.id, String($i18n.language ?? 'en'))}</strong>
					<small>{zh ? preset.description.zh : preset.description.en}</small>
				</button>
			{/each}
		</div>
	</details>

	<details class="mist-editor-group" open>
		<summary>
			<span><b>02</b>{copy('背景', 'Background')}</span>
			<button type="button" onclick={() => resetGroup('background')}>
				{copy('当前组重置', 'Reset group')}
			</button>
		</summary>
		{@render selectRow(
			copy('明暗模式', 'Theme mode'),
			draft.theme,
			[
				{ value: 'system', label: copy('跟随系统', 'Follow system') },
				{ value: 'light', label: copy('浅色', 'Light') },
				{ value: 'dark', label: copy('深色', 'Dark') }
			],
			(value) => setThemeMode(value as AppearanceTheme)
		)}
		<p class="mist-editor-note">
			{copy(
				'下面的浅色／深色按钮用于切换当前正在编辑的配色。',
				'The light and dark buttons below select which palette you are editing.'
			)}
		</p>
		<div class="mist-editor-segmented" role="group" aria-label={copy('编辑明暗模式', 'Edit mode')}>
			{#each ['light', 'dark'] as const as mode}
				<button
					type="button"
					data-active={editorMode === mode}
					onclick={() => switchEditorMode(mode)}
				>
					{modeLabel(mode)}
				</button>
			{/each}
		</div>
		{@render selectRow(
			copy('背景类型', 'Background type'),
			currentBackground.kind,
			[
				{ value: 'gradient', label: copy('渐变', 'Gradient') },
				{ value: 'local-image', label: copy('本地图片', 'Local image') }
			],
			(value) => {
				if (value === 'gradient') {
					setBackground({
						kind: 'gradient',
						gradient:
							currentBackground.kind === 'gradient'
								? currentBackground.gradient
								: (draft.preset as GradientId),
						mask: currentBackground.mask,
						blur: currentBackground.blur
					});
					const previewUrl = previewUrls[editorMode];
					if (previewUrl) URL.revokeObjectURL(previewUrl);
					delete previewUrls[editorMode];
					appearancePreviewWallpaperUrl.set(null);
				} else if (value === 'local-image') {
					// Prefer re-activating the most recent library image; otherwise show the
					// empty library (with an Add tile) so the branch actually renders.
					const fallback = library[0];
					if (fallback) {
						void selectLibraryImage(fallback.id);
					} else if (currentBackground.kind !== 'local-image') {
						setBackground({
							kind: 'local-image',
							assetId: '',
							crop: { x: 0, y: 0, width: 1, height: 1 },
							scale: 100,
							mask: currentBackground.mask,
							blur: currentBackground.blur
						});
					}
				}
			}
		)}
		<input
			bind:this={fileInput}
			type="file"
			accept="image/jpeg,image/png,image/webp"
			hidden
			onchange={chooseWallpaper}
		/>
		<p class="mist-editor-mode-label">{copy('界面预览', 'Interface preview')}</p>
		<InterfacePreview settings={draft} wallpaperUrl={previewWallpaperUrl} />
		{#if currentBackground.kind === 'gradient'}
			{@render selectRow(
				copy('渐变样式', 'Gradient'),
				currentBackground.gradient,
				GRADIENT_IDS.map((id) => ({ value: id, label: id })),
				(value) => setBackground({ ...currentBackground, gradient: value as GradientId })
			)}
		{:else}
			<div class="mist-wallpaper-library" role="list">
				<button
					type="button"
					class="mist-wallpaper-add"
					disabled={busy}
					onclick={() => fileInput?.click()}
				>
					<span aria-hidden="true">＋</span>
					{copy('添加图片', 'Add image')}
				</button>
				{#each library as item (item.id)}
					<figure
						class="mist-wallpaper-card"
						data-active={currentBackground.kind === 'local-image' &&
							currentBackground.assetId === item.id}
						role="listitem"
					>
						<button
							type="button"
							class="mist-wallpaper-card__select"
							onclick={() => selectLibraryImage(item.id)}
							aria-label={copy('使用这张图', 'Use this image')}
						>
							<img src={item.url} alt="" draggable="false" />
						</button>
						<button
							type="button"
							class="mist-wallpaper-card__remove"
							onclick={() => removeLibraryImage(item.id)}
							aria-label={copy('删除', 'Delete')}
						>
							×
						</button>
					</figure>
				{/each}
			</div>
			{#if currentBackground.kind === 'local-image'}
				{@const activeUrl =
					library.find((item) => item.id === currentBackground.assetId)?.url ??
					previewUrls[editorMode] ??
					null}
				{#if activeUrl}
					<p class="mist-editor-mode-label">{copy('拖动取景', 'Frame the region')}</p>
					<CropEditor
						imageUrl={activeUrl}
						crop={currentBackground.crop}
						onchange={(crop) => setBackground({ ...currentBackground, crop })}
					/>
				{/if}
			{/if}
			<div class="mist-editor-image-actions">
				<button type="button" class="mist-button mist-button--ghost" onclick={useImageColors}>
					{copy('从图片取色', 'Sample colors')}
				</button>
			</div>
			{@render rangeRow(
				copy('缩放', 'Scale'),
				Math.round(currentBackground.scale),
				100,
				300,
				5,
				'%',
				(value) => setBackground({ ...currentBackground, scale: value })
			)}
		{/if}
		{@render rangeRow(
			copy('遮罩', 'Mask'),
			Math.round(currentBackground.mask),
			0,
			80,
			1,
			'%',
			(value) => setBackground({ ...currentBackground, mask: value })
		)}
		{@render rangeRow(
			copy('静态模糊', 'Static blur'),
			Math.round(currentBackground.blur),
			0,
			30,
			1,
			'px',
			(value) => setBackground({ ...currentBackground, blur: value })
		)}
	</details>

	<details class="mist-editor-group">
		<summary>
			<span><b>03</b>{copy('色彩', 'Colors')}</span>
			<button type="button" onclick={() => resetGroup('colors')}>
				{copy('当前组重置', 'Reset group')}
			</button>
		</summary>
		<div class="mist-editor-mode-label">{modeLabel(editorMode)}</div>
		{@render colourRow(copy('强调色', 'Accent'), currentMode.colors.accent, (value) =>
			setModeColors('accent', value)
		)}
		{@render colourRow(copy('画布色', 'Canvas'), currentMode.colors.canvas, (value) =>
			setModeColors('canvas', value)
		)}
		{@render colourRow(copy('玻璃表面色', 'Glass surface'), currentMode.colors.surface, (value) =>
			setModeColors('surface', value)
		)}
		{@render rangeRow(
			copy('边框强度', 'Border strength'),
			Math.round(currentMode.colors.borderStrength),
			0,
			60,
			1,
			'%',
			(value) => setModeColors('borderStrength', value)
		)}
		<p class="mist-editor-note">
			{copy(
				`正文自动对比度 ${contrastReadable(tokens.ink, currentMode.colors.surface)}`,
				`Generated body contrast ${contrastReadable(tokens.ink, currentMode.colors.surface)}`
			)}
		</p>
	</details>

	<details class="mist-editor-group">
		<summary>
			<span><b>04</b>{copy('导航与列表', 'Navigation & lists')}</span>
			<button type="button" onclick={() => resetGroup('navigation')}>
				{copy('当前组重置', 'Reset group')}
			</button>
		</summary>
		{@render selectRow(
			copy('列表密度', 'List density'),
			draft.layout.navigation.density,
			[
				{ value: 'comfortable', label: copy('舒适 · 48px', 'Comfortable · 48px') },
				{ value: 'compact', label: copy('紧凑 · 40px', 'Compact · 40px') }
			],
			(value) => setLayoutGroup('navigation', 'density', value)
		)}
		{@render selectRow(
			copy('当前项指示', 'Current item'),
			draft.layout.navigation.current,
			[
				{ value: 'rail', label: copy('左侧线', 'Left rail') },
				{ value: 'fill', label: copy('淡色填充', 'Tinted fill') },
				{ value: 'both', label: copy('两者', 'Both') }
			],
			(value) => setLayoutGroup('navigation', 'current', value)
		)}
		<div class="mist-editor-subhead">{copy('导航表面覆盖', 'Navigation surface override')}</div>
		{@render overrideRow(
			'navigation',
			'opacity',
			copy('不透明度', 'Opacity'),
			40,
			100,
			draft.glass.opacity,
			'%'
		)}
		{@render overrideRow(
			'navigation',
			'blur',
			copy('玻璃模糊', 'Glass blur'),
			0,
			30,
			draft.glass.blur,
			'px'
		)}
		{@render overrideRow(
			'navigation',
			'radius',
			copy('圆角', 'Radius'),
			0,
			28,
			draft.glass.radius,
			'px'
		)}
	</details>

	<details class="mist-editor-group">
		<summary>
			<span><b>05</b>{copy('消息与输入', 'Messages & composer')}</span>
			<button type="button" onclick={() => resetGroup('messages')}>
				{copy('当前组重置', 'Reset group')}
			</button>
		</summary>
		<div class="mist-editor-subhead">{copy('用户消息', 'User message')}</div>
		{@render selectRow(
			copy('对齐', 'Alignment'),
			draft.layout.userMessage.alignment,
			[
				{ value: 'left', label: copy('左侧', 'Left') },
				{ value: 'right', label: copy('右侧', 'Right') }
			],
			(value) => setLayoutGroup('userMessage', 'alignment', value)
		)}
		{@render rangeRow(
			copy('最大宽度', 'Maximum width'),
			Math.round(draft.layout.userMessage.maxWidth),
			50,
			90,
			1,
			'%',
			(value) => setLayoutGroup('userMessage', 'maxWidth', value)
		)}
		{@render selectRow(
			copy('圆角形态', 'Corner shape'),
			draft.layout.userMessage.shape,
			[
				{ value: 'round', label: copy('圆润', 'Round') },
				{ value: 'soft', label: copy('柔和', 'Soft') },
				{ value: 'square', label: copy('近方形', 'Square') }
			],
			(value) => setLayoutGroup('userMessage', 'shape', value)
		)}
		{@render toggle(
			copy('显示用户头像', 'Show user avatar'),
			copy('桌面宽屏布局生效', 'Applies to wide desktop layouts'),
			draft.layout.userMessage.showAvatar,
			(value) => setLayoutGroup('userMessage', 'showAvatar', value)
		)}
		{@render overrideRow(
			'userMessage',
			'opacity',
			copy('不透明度', 'Opacity'),
			40,
			100,
			draft.glass.opacity,
			'%'
		)}
		{@render overrideRow(
			'userMessage',
			'radius',
			copy('圆角', 'Radius'),
			0,
			28,
			draft.glass.radius,
			'px'
		)}
		{@render overrideRow('userMessage', 'tint', copy('强调色淡染', 'Accent tint'), 0, 30, 0, '%')}

		<div class="mist-editor-subhead">{copy('助手消息', 'Assistant message')}</div>
		{@render selectRow(
			copy('表面形态', 'Surface'),
			draft.layout.assistantMessage.surface,
			[
				{ value: 'glass', label: copy('轻玻璃卡片', 'Light glass card') },
				{ value: 'reading', label: copy('阅读表面', 'Reading surface') }
			],
			(value) => setLayoutGroup('assistantMessage', 'surface', value)
		)}
		{@render selectRow(
			copy('阅读宽度', 'Reading width'),
			draft.layout.assistantMessage.readingWidth,
			[
				{ value: 720, label: '720px' },
				{ value: 880, label: '880px' },
				{ value: 1000, label: '1000px' }
			],
			(value) => setLayoutGroup('assistantMessage', 'readingWidth', Number(value))
		)}
		{@render toggle(
			copy('显示助手头像', 'Show assistant avatar'),
			'',
			draft.layout.assistantMessage.showAvatar,
			(value) => setLayoutGroup('assistantMessage', 'showAvatar', value)
		)}
		{@render toggle(
			copy('显示模型标题', 'Show model title'),
			'',
			draft.layout.assistantMessage.showModelTitle,
			(value) => setLayoutGroup('assistantMessage', 'showModelTitle', value)
		)}
		{@render selectRow(
			copy('推理与工具状态', 'Reasoning & tools'),
			draft.layout.assistantMessage.details,
			[
				{ value: 'collapsed', label: copy('默认收起', 'Collapsed') },
				{ value: 'expanded', label: copy('默认展开', 'Expanded') }
			],
			(value) => setLayoutGroup('assistantMessage', 'details', value)
		)}
		{@render overrideRow(
			'assistantMessage',
			'opacity',
			copy('不透明度', 'Opacity'),
			40,
			100,
			draft.glass.opacity,
			'%'
		)}
		{@render overrideRow(
			'assistantMessage',
			'radius',
			copy('圆角', 'Radius'),
			0,
			28,
			draft.glass.radius,
			'px'
		)}
		{@render overrideRow(
			'assistantMessage',
			'tint',
			copy('强调色淡染', 'Accent tint'),
			0,
			30,
			0,
			'%'
		)}

		<div class="mist-editor-subhead">{copy('输入框', 'Composer')}</div>
		{@render selectRow(
			copy('外观', 'Appearance'),
			draft.layout.composer.style,
			[
				{ value: 'glass', label: copy('玻璃', 'Glass') },
				{ value: 'solid', label: copy('实底', 'Solid') },
				{ value: 'minimal', label: copy('极简', 'Minimal') }
			],
			(value) => setLayoutGroup('composer', 'style', value)
		)}
		{@render selectRow(
			copy('最大宽度', 'Maximum width'),
			draft.layout.composer.width,
			[
				{ value: 720, label: '720px' },
				{ value: 820, label: '820px' },
				{ value: 960, label: '960px' }
			],
			(value) => setLayoutGroup('composer', 'width', Number(value))
		)}
		{@render selectRow(
			copy('按钮密度', 'Button density'),
			draft.layout.composer.density,
			[
				{ value: 'comfortable', label: copy('常规', 'Comfortable') },
				{ value: 'compact', label: copy('紧凑', 'Compact') }
			],
			(value) => setLayoutGroup('composer', 'density', value)
		)}
		{@render overrideRow(
			'composer',
			'opacity',
			copy('不透明度', 'Opacity'),
			40,
			100,
			draft.glass.opacity,
			'%'
		)}
		{@render overrideRow(
			'composer',
			'blur',
			copy('玻璃模糊', 'Glass blur'),
			0,
			30,
			draft.glass.blur,
			'px'
		)}
		{@render overrideRow(
			'composer',
			'radius',
			copy('圆角', 'Radius'),
			0,
			28,
			draft.glass.radius,
			'px'
		)}
	</details>

	<details class="mist-editor-group">
		<summary>
			<span><b>06</b>{copy('浮层与阅读', 'Overlays & reading')}</span>
			<button type="button" onclick={() => resetGroup('overlays')}>
				{copy('当前组重置', 'Reset group')}
			</button>
		</summary>
		{@render rangeRow(
			copy('浮层背景遮罩', 'Overlay scrim'),
			Math.round(draft.glass.overlayScrim),
			0,
			80,
			1,
			'%',
			(value) => setGlass('overlayScrim', value)
		)}
		{@render overrideRow(
			'overlay',
			'opacity',
			copy('浮层不透明度', 'Overlay opacity'),
			40,
			100,
			draft.glass.opacity,
			'%'
		)}
		{@render overrideRow(
			'overlay',
			'blur',
			copy('浮层模糊', 'Overlay blur'),
			0,
			30,
			draft.glass.blur,
			'px'
		)}
		{@render overrideRow(
			'overlay',
			'radius',
			copy('浮层圆角', 'Overlay radius'),
			0,
			28,
			draft.glass.radius,
			'px'
		)}
		{@render overrideRow(
			'reading',
			'opacity',
			copy('阅读面不透明度', 'Reading opacity'),
			40,
			100,
			draft.glass.opacity,
			'%'
		)}
		{@render overrideRow(
			'reading',
			'blur',
			copy('阅读面模糊', 'Reading blur'),
			0,
			30,
			draft.glass.blur,
			'px'
		)}
		{@render overrideRow(
			'reading',
			'radius',
			copy('阅读面圆角', 'Reading radius'),
			0,
			28,
			draft.glass.radius,
			'px'
		)}
	</details>

	<details class="mist-editor-group">
		<summary>
			<span><b>07</b>{copy('阅读与代码', 'Reading & code')}</span>
			<button type="button" onclick={() => resetGroup('reading')}>
				{copy('当前组重置', 'Reset group')}
			</button>
		</summary>
		{@render rangeRow(
			copy('正文字号', 'Body size'),
			draft.reading.fontSize,
			14,
			19,
			1,
			'px',
			(value) => setReading('fontSize', value)
		)}
		{@render rangeRow(
			copy('正文行距', 'Line height'),
			draft.reading.lineHeight,
			1.45,
			1.9,
			0.05,
			'',
			(value) => setReading('lineHeight', value)
		)}
		{@render rangeRow(
			copy('段落间距', 'Paragraph gap'),
			draft.reading.paragraphSpacing,
			0.5,
			1.2,
			0.1,
			'em',
			(value) => setReading('paragraphSpacing', value)
		)}
		{@render selectRow(
			copy('代码块背景', 'Code block surface'),
			draft.reading.codeTone,
			[
				{ value: 'auto', label: copy('自动', 'Automatic') },
				{ value: 'glass', label: copy('玻璃', 'Glass') },
				{ value: 'solid', label: copy('实底', 'Solid') }
			],
			(value) => setReading('codeTone', value as AppearanceSettings['reading']['codeTone'])
		)}
		{@render rangeRow(
			copy('代码字号', 'Code size'),
			draft.reading.codeFontSize,
			12,
			16,
			1,
			'px',
			(value) => setReading('codeFontSize', value)
		)}
		{@render toggle(
			copy('代码自动换行', 'Wrap code lines'),
			copy('长行在卡片内换行', 'Long lines wrap inside the block'),
			draft.reading.codeWrap,
			(value) => setReading('codeWrap', value)
		)}
	</details>

	<details class="mist-editor-group">
		<summary>
			<span><b>08</b>{copy('动效与交换', 'Motion & transfer')}</span>
			<button type="button" onclick={() => resetGroup('motion')}>
				{copy('当前组重置', 'Reset group')}
			</button>
		</summary>
		<div class="mist-editor-segmented" role="group" aria-label={copy('动效', 'Motion')}>
			{#each ['off', 'gentle', 'fluid'] as const as level}
				<button
					type="button"
					data-active={draft.motion === level}
					onclick={() => (draft = { ...draft, motion: level })}
				>
					{level === 'off'
						? copy('关闭', 'Off')
						: level === 'gentle'
							? copy('轻柔', 'Gentle')
							: copy('流畅', 'Fluid')}
				</button>
			{/each}
		</div>
		<p class="mist-editor-note">
			{copy(
				'系统启用“减少动态效果”时会自动降级。',
				'The system reduced-motion setting always takes precedence.'
			)}
		</p>
		<div class="mist-editor-image-actions">
			<button
				type="button"
				class="mist-button mist-button--secondary"
				onclick={() => importInput?.click()}
			>
				{copy('导入主题 JSON', 'Import theme JSON')}
			</button>
			<button type="button" class="mist-button mist-button--secondary" onclick={exportTheme}>
				{copy('导出当前主题', 'Export current theme')}
			</button>
			<input
				bind:this={importInput}
				type="file"
				accept="application/json,.json"
				hidden
				onchange={importTheme}
			/>
		</div>
		<p class="mist-editor-note">
			{copy(
				'主题文件不包含壁纸、服务地址、登录凭据或聊天内容。',
				'Theme files never include wallpapers, service addresses, credentials or chat content.'
			)}
		</p>
	</details>
</MistDrawer>

{#if open && collapsed}
	<button
		type="button"
		class="mist-editor-fab"
		onclick={() => (collapsed = false)}
		aria-label={copy('展开外观面板', 'Expand appearance panel')}
	>
		<span aria-hidden="true">🎨</span>
	</button>
{/if}

<style>
	.mist-editor-status {
		position: sticky;
		top: 0;
		z-index: 3;
		display: flex;
		align-items: center;
		gap: 8px;
		margin: -2px 0 12px;
		padding: 8px 10px;
		border: 1px solid var(--mist-border);
		border-radius: 12px;
		background: rgb(var(--mist-reading-rgb) / 0.82);
		backdrop-filter: blur(var(--mist-overlay-blur));
		color: var(--mist-muted);
		font-size: 12px;
	}

	.mist-editor-status__dot {
		width: 7px;
		height: 7px;
		border-radius: 999px;
		background: var(--mist-accent);
		box-shadow: 0 0 0 4px color-mix(in srgb, var(--mist-accent) 14%, transparent);
	}

	.mist-editor-status__swatch {
		width: 18px;
		height: 18px;
		margin-left: auto;
		border: 1px solid var(--mist-border);
		border-radius: 6px;
	}

	.mist-editor-summary {
		display: grid;
		gap: 12px;
		margin-bottom: 12px;
		padding: 14px;
		border: 1px solid var(--mist-border);
		border-radius: var(--mist-overlay-radius);
		background: rgb(var(--mist-surface-rgb) / var(--mist-reading-alpha));
	}

	.mist-editor-summary h3,
	.mist-editor-summary p {
		margin: 0;
	}

	.mist-editor-summary h3 {
		color: var(--mist-ink);
		font-size: 15px;
	}

	.mist-editor-summary p {
		margin-top: 4px;
		color: var(--mist-muted);
		font-size: 12px;
		line-height: 1.5;
	}

	.mist-editor-summary__toggles {
		display: grid;
		gap: 4px;
	}

	.mist-editor-group {
		margin: 8px 0;
		border: 1px solid var(--mist-border);
		border-radius: var(--mist-overlay-radius);
		background: rgb(var(--mist-surface-rgb) / var(--mist-reading-alpha));
		overflow: clip;
	}

	.mist-editor-group > summary {
		display: flex;
		min-height: 48px;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 12px;
		cursor: pointer;
		list-style: none;
		color: var(--mist-ink);
	}

	.mist-editor-group > summary::-webkit-details-marker {
		display: none;
	}

	.mist-editor-group > summary > span {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 14px;
		font-weight: 650;
	}

	.mist-editor-group > summary b {
		color: var(--mist-accent-text);
		font-size: 10px;
		letter-spacing: 0.08em;
	}

	.mist-editor-group > summary small {
		color: var(--mist-muted);
		font-size: 11px;
		font-weight: 400;
	}

	.mist-editor-group > summary button {
		min-height: 32px;
		border: 0;
		border-radius: 8px;
		padding: 0 8px;
		background: transparent;
		color: var(--mist-muted);
		font-size: 11px;
	}

	.mist-editor-group[open] > summary {
		border-bottom: 1px solid var(--mist-border);
	}

	.mist-editor-group > :not(summary) {
		margin-inline: 12px;
	}

	.mist-editor-group > :last-child {
		margin-bottom: 12px;
	}

	.mist-preset-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 8px;
		padding-top: 12px;
	}

	.mist-preset {
		display: grid;
		min-width: 0;
		gap: 3px;
		padding: 10px;
		border: 1px solid var(--mist-border);
		border-radius: 12px;
		background: transparent;
		color: var(--mist-ink);
		text-align: left;
	}

	.mist-preset[data-active='true'] {
		border-color: color-mix(in srgb, var(--mist-accent) 58%, var(--mist-border));
		background: color-mix(in srgb, var(--mist-accent) 9%, transparent);
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--mist-accent) 26%, transparent);
	}

	.mist-preset__swatch {
		width: 100%;
		height: 18px;
		margin-bottom: 4px;
		border-radius: 7px;
		background: var(--preset-light);
	}

	.mist-preset__swatch[data-preset='mist-blue'] {
		background: linear-gradient(100deg, #b8d1e8, #edf4fa 60%, #8eb8e8);
	}
	.mist-preset__swatch[data-preset='teal-slate'] {
		background: linear-gradient(100deg, #b9d9d5, #e9f4f2 60%, #64aaa3);
	}
	.mist-preset__swatch[data-preset='warm-sand'] {
		background: linear-gradient(100deg, #e4cfb8, #f7efe5 60%, #c98c65);
	}
	.mist-preset__swatch[data-preset='graphite'] {
		background: linear-gradient(100deg, #c4ccd5, #edf0f3 60%, #7e8b9a);
	}
	.mist-preset__swatch[data-preset='mist-rose'] {
		background: linear-gradient(100deg, #e8c9d9, #f9eff5 60%, #cf84a7);
	}
	.mist-preset__swatch[data-preset='midnight'] {
		background: linear-gradient(100deg, #182439, #293b5c 60%, #080d18);
	}

	.mist-preset strong {
		overflow: hidden;
		font-size: 12px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.mist-preset small {
		overflow: hidden;
		color: var(--mist-muted);
		font-size: 10px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.mist-editor-row,
	.mist-editor-field,
	.mist-editor-colour,
	.mist-editor-override {
		display: flex;
		min-height: 44px;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		border-bottom: 1px solid rgb(var(--mist-surface-rgb) / 0.09);
		color: var(--mist-ink);
		font-size: 12px;
	}

	.mist-editor-row > span {
		display: grid;
		gap: 2px;
	}

	.mist-editor-row strong {
		font-size: 12px;
		font-weight: 600;
	}

	.mist-editor-row small {
		color: var(--mist-muted);
		font-size: 10px;
	}

	.mist-editor-switch {
		appearance: none;
		width: 42px;
		height: 24px;
		flex: 0 0 auto;
		border: 1px solid var(--mist-border);
		border-radius: 999px;
		background: rgb(var(--mist-surface-rgb) / 0.22);
	}

	.mist-editor-switch::before {
		content: '';
		display: block;
		width: 18px;
		height: 18px;
		margin: 2px;
		border-radius: 999px;
		background: var(--mist-muted);
		transition: transform var(--mist-duration-fast) var(--mist-ease);
	}

	.mist-editor-switch:checked {
		border-color: var(--mist-accent);
		background: var(--mist-accent);
	}

	.mist-editor-switch:checked::before {
		background: var(--mist-accent-contrast);
		transform: translateX(18px);
	}

	.mist-editor-field select,
	.mist-editor-override input {
		min-width: 112px;
		max-width: 170px;
		min-height: 34px;
		border: 1px solid var(--mist-border);
		border-radius: 9px;
		background: rgb(var(--mist-reading-rgb) / 0.72);
		padding: 0 9px;
		color: var(--mist-ink);
		font-size: 12px;
	}

	.mist-editor-range {
		display: grid;
		gap: 2px;
		padding: 5px 0;
		color: var(--mist-ink);
		font-size: 12px;
	}

	.mist-editor-range > span {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.mist-editor-range b {
		color: var(--mist-muted);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}

	.mist-editor-range input {
		width: 100%;
		height: 34px;
		accent-color: var(--mist-accent);
	}

	.mist-editor-colour__control {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.mist-editor-colour input {
		width: 34px;
		height: 30px;
		border: 1px solid var(--mist-border);
		border-radius: 8px;
		background: transparent;
		padding: 2px;
	}

	.mist-editor-colour code {
		color: var(--mist-muted);
		font-size: 10px;
	}

	.mist-editor-override input {
		min-width: 82px;
		width: 82px;
	}

	.mist-editor-override button {
		width: 30px;
		height: 30px;
		border: 0;
		border-radius: 8px;
		background: transparent;
		color: var(--mist-muted);
	}

	.mist-editor-override button:not(:disabled):hover {
		background: rgb(var(--mist-surface-rgb) / 0.12);
		color: var(--mist-ink);
	}

	.mist-editor-override button:disabled {
		opacity: 0.3;
	}

	.mist-editor-segmented {
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: 1fr;
		gap: 3px;
		margin-top: 10px;
		padding: 3px;
		border: 1px solid var(--mist-border);
		border-radius: 10px;
		background: rgb(var(--mist-reading-rgb) / 0.58);
	}

	.mist-editor-segmented button {
		min-height: 34px;
		border: 0;
		border-radius: 7px;
		background: transparent;
		color: var(--mist-muted);
		font-size: 11px;
	}

	.mist-editor-segmented button[data-active='true'] {
		background: rgb(var(--mist-surface-rgb) / 0.35);
		color: var(--mist-ink);
		box-shadow: 0 1px 5px var(--mist-shadow);
	}

	.mist-editor-subhead,
	.mist-editor-mode-label {
		margin: 12px 0 3px;
		color: var(--mist-muted);
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.07em;
		text-transform: uppercase;
	}

	.mist-editor-note {
		margin: 10px 0;
		color: var(--mist-muted);
		font-size: 10px;
		line-height: 1.5;
	}

	.mist-editor-image-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin: 10px 0;
	}

	.mist-editor-collapse {
		margin-left: 6px;
		padding: 3px 10px;
		border: 1px solid var(--mist-border);
		border-radius: 999px;
		background: transparent;
		color: var(--mist-muted);
		font-size: 11px;
		cursor: pointer;
	}

	.mist-editor-collapse:hover {
		color: var(--mist-ink);
		background: rgb(var(--mist-surface-rgb) / 0.18);
	}

	.mist-wallpaper-library {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
		gap: 8px;
		margin: 10px 0;
	}

	.mist-wallpaper-add {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 4px;
		min-height: 72px;
		border: 1px dashed var(--mist-border);
		border-radius: 12px;
		background: transparent;
		color: var(--mist-muted);
		font-size: 11px;
		cursor: pointer;
	}

	.mist-wallpaper-add span {
		font-size: 20px;
		line-height: 1;
	}

	.mist-wallpaper-add:not(:disabled):hover {
		color: var(--mist-ink);
		border-color: var(--mist-accent);
	}

	.mist-wallpaper-card {
		position: relative;
		margin: 0;
		border-radius: 12px;
		overflow: hidden;
		border: 2px solid transparent;
	}

	.mist-wallpaper-card[data-active='true'] {
		border-color: var(--mist-accent);
	}

	.mist-wallpaper-card__select {
		display: block;
		width: 100%;
		padding: 0;
		border: 0;
		background: none;
		cursor: pointer;
	}

	.mist-wallpaper-card__select img {
		display: block;
		width: 100%;
		height: 72px;
		object-fit: cover;
	}

	.mist-wallpaper-card__remove {
		position: absolute;
		top: 3px;
		right: 3px;
		width: 20px;
		height: 20px;
		border: 0;
		border-radius: 999px;
		background: rgb(7 11 20 / 0.6);
		color: #fff;
		font-size: 13px;
		line-height: 1;
		cursor: pointer;
	}

	.mist-wallpaper-card__remove:hover {
		background: rgb(7 11 20 / 0.85);
	}

	.mist-editor-footer-spacer {
		flex: 1;
	}

	.mist-editor-fab {
		position: fixed;
		right: 18px;
		bottom: calc(18px + env(safe-area-inset-bottom, 0px));
		z-index: 60;
		width: 52px;
		height: 52px;
		border: 1px solid var(--mist-border);
		border-radius: 999px;
		background: rgb(var(--mist-surface-rgb) / var(--mist-overlay-alpha));
		backdrop-filter: blur(var(--mist-overlay-blur)) saturate(1.1);
		box-shadow: 0 12px 32px var(--mist-shadow);
		font-size: 22px;
		cursor: pointer;
	}

	.mist-editor-fab:hover {
		transform: translateY(-2px);
	}

	@media (max-width: 767px) {
		.mist-editor-summary,
		.mist-editor-group {
			border-radius: 14px;
		}

		.mist-preset-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
