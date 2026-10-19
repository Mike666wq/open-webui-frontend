<script lang="ts">
	import { getContext } from 'svelte';
	import {
		appearanceSettings,
		directoryEnabled,
		presetName,
		resolvedAppearanceTheme
	} from '$lib/appearance';

	const i18n = getContext<any>('i18n');
	const zh = $derived(
		String($i18n.language ?? '')
			.toLowerCase()
			.startsWith('zh')
	);
	const copy = (chinese: string, english: string) => (zh ? chinese : english);
	let { onedit }: { onedit?: () => void } = $props();
	const modeLabel = $derived(
		$appearanceSettings.theme === 'system'
			? copy(
					`跟随系统 · 当前${$resolvedAppearanceTheme === 'dark' ? '深色' : '浅色'}`,
					`System · currently ${$resolvedAppearanceTheme}`
				)
			: $appearanceSettings.theme === 'dark'
				? copy('深色', 'Dark')
				: copy('浅色', 'Light')
	);
</script>

<div class="mist-settings-page">
	<header class="mist-settings-hero">
		<div class="mist-settings-hero__mark" aria-hidden="true">
			<span></span><span></span><span></span>
		</div>
		<div>
			<p class="mist-settings-eyebrow">{copy('本机外观', 'On-device appearance')}</p>
			<h2>{copy('Mist Glass', 'Mist Glass')}</h2>
			<p>
				{copy(
					'统一聊天、导航、浮层和阅读表面的玻璃材质。配置只保存在当前设备，并按服务地址隔离。',
					'One glass language for chat, navigation, overlays and reading surfaces. Settings stay on this device and are isolated by service origin.'
				)}
			</p>
		</div>
		<span class="mist-settings-state" data-enabled={$appearanceSettings.enabled}>
			{$appearanceSettings.enabled ? copy('已启用', 'Enabled') : copy('已关闭', 'Disabled')}
		</span>
	</header>

	<div class="mist-settings-preview" aria-hidden="true">
		<div class="mist-settings-preview__rail">
			<i></i><i></i><i></i>
		</div>
		<div class="mist-settings-preview__chat">
			<div class="mist-settings-preview__bubble"></div>
			<div class="mist-settings-preview__card">
				<span></span><span></span><span></span>
			</div>
			<div class="mist-settings-preview__composer"></div>
		</div>
	</div>

	<div class="mist-settings-grid">
		<div class="mist-settings-card">
			<small>{copy('视觉预设', 'Preset')}</small>
			<strong>{presetName($appearanceSettings.preset, String($i18n.language ?? 'en'))}</strong>
			<span>{modeLabel}</span>
		</div>
		<div class="mist-settings-card">
			<small>{copy('玻璃基底', 'Glass base')}</small>
			<strong>{$appearanceSettings.glass.opacity}%</strong>
			<span>
				{$appearanceSettings.glass.blur}px · {$appearanceSettings.glass.radius}px
			</span>
		</div>
		<div class="mist-settings-card">
			<small>{copy('对话目录', 'Conversation navigator')}</small>
			<strong>{$directoryEnabled ? copy('开启', 'On') : copy('关闭', 'Off')}</strong>
			<span>{copy('只索引已加载消息', 'Loaded branch only')}</span>
		</div>
		<div class="mist-settings-card">
			<small>{copy('阅读', 'Reading')}</small>
			<strong>{$appearanceSettings.reading.fontSize}px</strong>
			<span>{$appearanceSettings.reading.lineHeight.toFixed(2)} ×</span>
		</div>
	</div>

	<div class="mist-settings-actions">
		<div>
			<h3>{copy('外观与阅读编辑器', 'Appearance & reading editor')}</h3>
			<p>
				{copy(
					'预设、背景、色彩、六类组件覆盖、阅读和动效都可在真实页面上预览。',
					'Preview presets, backgrounds, colors, six component slots, reading and motion on the real page.'
				)}
			</p>
		</div>
		<button
			type="button"
			class="mist-button mist-button--primary"
			onclick={() => onedit?.()}
			id="open-mist-appearance-editor"
		>
			{copy('打开编辑器', 'Open editor')}
		</button>
	</div>

	<p class="mist-settings-footnote">
		{copy(
			'不会上传壁纸或聊天内容。主题 JSON 仅包含可复用的视觉参数，不包含图片、服务地址和凭据。',
			'Wallpapers and chat content are never uploaded. Theme JSON includes reusable visual parameters only, without images, addresses or credentials.'
		)}
	</p>
</div>

<style>
	.mist-settings-page {
		display: grid;
		gap: 16px;
		width: min(100%, 820px);
		margin: 0 auto;
		padding: 4px 0 32px;
	}

	.mist-settings-hero {
		position: relative;
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: start;
		gap: 14px;
		padding: 18px;
		border: 1px solid var(--mist-border);
		border-radius: var(--mist-reading-radius);
		background: rgb(var(--mist-surface-rgb) / var(--mist-reading-alpha));
		box-shadow:
			inset 0 1px 0 var(--mist-highlight),
			0 14px 38px var(--mist-shadow);
	}

	.mist-settings-hero p,
	.mist-settings-hero h2 {
		margin: 0;
	}

	.mist-settings-hero h2 {
		margin-block: 2px 5px;
		color: var(--mist-ink);
		font-size: clamp(20px, 3vw, 27px);
	}

	.mist-settings-hero > div > p:last-child {
		max-width: 58ch;
		color: var(--mist-muted);
		font-size: 12px;
		line-height: 1.55;
	}

	.mist-settings-eyebrow {
		color: var(--mist-accent-text);
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.09em;
		text-transform: uppercase;
	}

	.mist-settings-hero__mark {
		display: grid;
		width: 42px;
		height: 42px;
		place-content: center;
		gap: 3px;
		border: 1px solid var(--mist-border);
		border-radius: 13px;
		background: color-mix(in srgb, var(--mist-accent) 12%, transparent);
	}

	.mist-settings-hero__mark span {
		width: 20px;
		height: 5px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--mist-accent) 64%, var(--mist-ink));
	}

	.mist-settings-hero__mark span:nth-child(2) {
		width: 14px;
		opacity: 0.72;
	}

	.mist-settings-state {
		border: 1px solid var(--mist-border);
		border-radius: 999px;
		padding: 4px 9px;
		color: var(--mist-muted);
		font-size: 10px;
		white-space: nowrap;
	}

	.mist-settings-state[data-enabled='true'] {
		border-color: color-mix(in srgb, var(--mist-accent) 32%, var(--mist-border));
		background: color-mix(in srgb, var(--mist-accent) 9%, transparent);
		color: var(--mist-ink);
	}

	.mist-settings-preview {
		display: grid;
		grid-template-columns: 76px minmax(0, 1fr);
		gap: 10px;
		min-height: 180px;
		padding: 12px;
		border: 1px solid var(--mist-border);
		border-radius: var(--mist-reading-radius);
		background:
			radial-gradient(
				80% 90% at 20% 0%,
				color-mix(in srgb, var(--mist-accent) 22%, transparent),
				transparent 68%
			),
			rgb(var(--mist-canvas-rgb) / 0.52);
		overflow: hidden;
	}

	.mist-settings-preview__rail,
	.mist-settings-preview__chat {
		display: flex;
		flex-direction: column;
		gap: 7px;
		border: 1px solid var(--mist-border);
		border-radius: var(--mist-navigation-radius);
		background: rgb(var(--mist-surface-rgb) / var(--mist-navigation-alpha));
		padding: 10px;
		backdrop-filter: blur(var(--mist-navigation-blur));
	}

	.mist-settings-preview__rail i {
		display: block;
		height: 10px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--mist-muted) 25%, transparent);
	}

	.mist-settings-preview__rail i:first-child {
		width: 72%;
		background: var(--mist-accent);
	}

	.mist-settings-preview__chat {
		align-items: stretch;
	}

	.mist-settings-preview__bubble {
		align-self: flex-end;
		width: 46%;
		height: 22px;
		border-radius: var(--mist-user-radius);
		background: color-mix(in srgb, var(--mist-accent) 24%, rgb(var(--mist-surface-rgb) / 0.58));
	}

	.mist-settings-preview__card {
		display: grid;
		gap: 6px;
		padding: 11px;
		border: 1px solid var(--mist-border);
		border-radius: var(--mist-assistant-radius);
		background: rgb(var(--mist-surface-rgb) / var(--mist-assistant-alpha));
	}

	.mist-settings-preview__card span {
		height: 7px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--mist-muted) 22%, transparent);
	}

	.mist-settings-preview__card span:nth-child(2) {
		width: 82%;
	}

	.mist-settings-preview__card span:nth-child(3) {
		width: 58%;
	}

	.mist-settings-preview__composer {
		height: 34px;
		margin-top: auto;
		border: 1px solid var(--mist-border);
		border-radius: min(var(--mist-composer-radius), 18px);
		background: rgb(var(--mist-reading-rgb) / var(--mist-composer-alpha));
		backdrop-filter: blur(var(--mist-composer-blur));
	}

	.mist-settings-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 8px;
	}

	.mist-settings-card {
		display: grid;
		gap: 3px;
		padding: 11px;
		border: 1px solid var(--mist-border);
		border-radius: 11px;
		background: rgb(var(--mist-surface-rgb) / var(--mist-reading-alpha));
	}

	.mist-settings-card small,
	.mist-settings-card span {
		overflow: hidden;
		color: var(--mist-muted);
		font-size: 10px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.mist-settings-card strong {
		color: var(--mist-ink);
		font-size: 14px;
	}

	.mist-settings-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 14px;
		border: 1px solid var(--mist-border);
		border-radius: var(--mist-reading-radius);
		background: rgb(var(--mist-surface-rgb) / var(--mist-reading-alpha));
	}

	.mist-settings-actions h3,
	.mist-settings-actions p {
		margin: 0;
	}

	.mist-settings-actions h3 {
		color: var(--mist-ink);
		font-size: 14px;
	}

	.mist-settings-actions p,
	.mist-settings-footnote {
		margin-top: 3px;
		color: var(--mist-muted);
		font-size: 11px;
		line-height: 1.5;
	}

	.mist-settings-footnote {
		margin: 0;
		text-align: center;
	}

	@media (max-width: 767px) {
		.mist-settings-hero {
			grid-template-columns: auto minmax(0, 1fr);
		}

		.mist-settings-state {
			grid-column: 2;
			width: fit-content;
		}

		.mist-settings-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.mist-settings-actions {
			align-items: stretch;
			flex-direction: column;
		}
	}
</style>
