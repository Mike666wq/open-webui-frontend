<script>
	import { getContext } from 'svelte';
	const i18n = getContext('i18n');

	/**
	 * The TipTap editor these buttons drive. Typed explicitly so optional chaining
	 * resolves to Editor instead of `never`; before this, every call site emitted a
	 * spurious "Property 'chain' does not exist on type 'never'" diagnostic.
	 * @type {import('@tiptap/core').Editor | null}
	 */
	export let editor = null;

	import Bold from '$lib/components/icons/Bold.svelte';
	import CodeBracket from '$lib/components/icons/CodeBracket.svelte';
	import H1 from '$lib/components/icons/H1.svelte';
	import H2 from '$lib/components/icons/H2.svelte';
	import H3 from '$lib/components/icons/H3.svelte';
	import Italic from '$lib/components/icons/Italic.svelte';
	import ListBullet from '$lib/components/icons/ListBullet.svelte';
	import NumberedList from '$lib/components/icons/NumberedList.svelte';
	import Strikethrough from '$lib/components/icons/Strikethrough.svelte';
	import Underline from '$lib/components/icons/Underline.svelte';

	// P-007 K19: blockquote, table, horizontal rule, highlight, superscript and
	// subscript were reachable only through keyboard shortcuts or bare text
	// glyphs. They now use the same icon/markup pattern as the rest of the bar.
	import Blockquote from '$lib/components/icons/Blockquote.svelte';
	import Grid from '$lib/components/icons/Grid.svelte';
	import Highlighter from '$lib/components/icons/Highlighter.svelte';
	import Minus from '$lib/components/icons/Minus.svelte';
	import Subscript from '$lib/components/icons/Subscript.svelte';
	import Superscript from '$lib/components/icons/Superscript.svelte';

	import Tooltip from '../Tooltip.svelte';
	import CheckBox from '$lib/components/icons/CheckBox.svelte';
	import ArrowLeftTag from '$lib/components/icons/ArrowLeftTag.svelte';
	import ArrowRightTag from '$lib/components/icons/ArrowRightTag.svelte';

	import EmojiPicker from '../EmojiPicker.svelte';
	import FaceSmile from '$lib/components/icons/FaceSmile.svelte';
	import { shortCodesToEmojis } from '$lib/stores';
</script>

<div
	class="flex flex-wrap max-w-[min(94vw,36rem)] gap-0.5 p-0.5 rounded-xl shadow-lg bg-white text-gray-800 dark:text-white dark:bg-gray-850 border border-gray-100 dark:border-gray-800"
>
	<Tooltip placement="top" content={$i18n.t('H1')}>
		<button
			on:click={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
			class="{editor?.isActive('heading', { level: 1 })
				? 'bg-gray-50 dark:bg-gray-700'
				: ''} hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg p-1.5 transition-all"
			type="button"
		>
			<H1 />
		</button>
	</Tooltip>

	<Tooltip placement="top" content={$i18n.t('H2')}>
		<button
			on:click={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
			class="{editor?.isActive('heading', { level: 2 })
				? 'bg-gray-50 dark:bg-gray-700'
				: ''} hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg p-1.5 transition-all"
			type="button"
		>
			<H2 />
		</button>
	</Tooltip>

	<Tooltip placement="top" content={$i18n.t('H3')}>
		<button
			on:click={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
			class="{editor?.isActive('heading', { level: 3 })
				? 'bg-gray-50 dark:bg-gray-700'
				: ''} hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg p-1.5 transition-all"
			type="button"
		>
			<H3 />
		</button>
	</Tooltip>

	{#if editor?.isActive('bulletList') || editor?.isActive('orderedList') || editor?.isActive('taskList')}
		<Tooltip placement="top" content={$i18n.t('Lift List (Shift+Tab)')}>
			<button
				on:click={() => {
					editor?.commands.liftListItem(editor?.isActive('taskList') ? 'taskItem' : 'listItem');
				}}
				class="hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg p-1.5 transition-all"
				aria-label={$i18n.t('Lift List (Shift+Tab)')}
				type="button"
			>
				<ArrowLeftTag />
			</button>
		</Tooltip>
		<Tooltip placement="top" content={$i18n.t('Sink List (Tab)')}>
			<button
				on:click={() =>
					editor?.commands.sinkListItem(editor?.isActive('taskList') ? 'taskItem' : 'listItem')}
				class="hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg p-1.5 transition-all"
				aria-label={$i18n.t('Sink List (Tab)')}
				type="button"
			>
				<ArrowRightTag />
			</button>
		</Tooltip>
	{/if}

	<Tooltip placement="top" content={$i18n.t('Bullet List')}>
		<button
			on:click={() => editor?.chain().focus().toggleBulletList().run()}
			class="{editor?.isActive('bulletList')
				? 'bg-gray-50 dark:bg-gray-700'
				: ''} hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg p-1.5 transition-all"
			type="button"
		>
			<ListBullet />
		</button>
	</Tooltip>

	<Tooltip placement="top" content={$i18n.t('Ordered List')}>
		<button
			on:click={() => editor?.chain().focus().toggleOrderedList().run()}
			class="{editor?.isActive('orderedList')
				? 'bg-gray-50 dark:bg-gray-700'
				: ''} hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg p-1.5 transition-all"
			type="button"
		>
			<NumberedList />
		</button>
	</Tooltip>

	<Tooltip placement="top" content={$i18n.t('Task List')}>
		<button
			on:click={() => editor?.chain().focus().toggleTaskList().run()}
			class="{editor?.isActive('taskList')
				? 'bg-gray-50 dark:bg-gray-700'
				: ''} hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg p-1.5 transition-all"
			type="button"
		>
			<CheckBox />
		</button>
	</Tooltip>

	<Tooltip placement="top" content={$i18n.t('Bold')}>
		<button
			on:click={() => editor?.chain().focus().toggleBold().run()}
			class="{editor?.isActive('bold')
				? 'bg-gray-50 dark:bg-gray-700'
				: ''} hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg p-1.5 transition-all"
			type="button"
		>
			<Bold />
		</button>
	</Tooltip>

	<Tooltip placement="top" content={$i18n.t('Italic')}>
		<button
			on:click={() => editor?.chain().focus().toggleItalic().run()}
			class="{editor?.isActive('italic')
				? 'bg-gray-50 dark:bg-gray-700'
				: ''} hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg p-1.5 transition-all"
			type="button"
		>
			<Italic />
		</button>
	</Tooltip>

	<Tooltip placement="top" content={$i18n.t('Underline')}>
		<button
			on:click={() => editor?.chain().focus().toggleUnderline().run()}
			class="{editor?.isActive('underline')
				? 'bg-gray-50 dark:bg-gray-700'
				: ''} hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg p-1.5 transition-all"
			type="button"
		>
			<Underline />
		</button>
	</Tooltip>

	<Tooltip placement="top" content={$i18n.t('Strikethrough')}>
		<button
			on:click={() => editor?.chain().focus().toggleStrike().run()}
			class="{editor?.isActive('strike')
				? 'bg-gray-50 dark:bg-gray-700'
				: ''} hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg p-1.5 transition-all"
			type="button"
		>
			<Strikethrough />
		</button>
	</Tooltip>

	<Tooltip placement="top" content={$i18n.t('Code Block')}>
		<button
			on:click={() => editor?.chain().focus().toggleCodeBlock().run()}
			class="{editor?.isActive('codeBlock')
				? 'bg-gray-50 dark:bg-gray-700'
				: ''} hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg p-1.5 transition-all"
			type="button"
		>
			<CodeBracket />
		</button>
	</Tooltip>

	<Tooltip placement="top" content={$i18n.t('Blockquote')}>
		<button
			on:click={() => editor?.chain().focus().toggleBlockquote().run()}
			class="{editor?.isActive('blockquote')
				? 'bg-gray-50 dark:bg-gray-700'
				: ''} hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg p-1.5 transition-all"
			type="button"
			aria-label={$i18n.t('Blockquote')}
		>
			<Blockquote />
		</button>
	</Tooltip>

	<Tooltip placement="top" content={$i18n.t('Insert table')}>
		<button
			on:click={() =>
				editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
			class="hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg p-1.5 transition-all"
			type="button"
			aria-label={$i18n.t('Insert table')}
		>
			<Grid />
		</button>
	</Tooltip>

	{#if editor?.isActive('table')}
		<Tooltip placement="top" content={$i18n.t('Add table row')}>
			<button
				on:click={() => editor?.chain().focus().addRowAfter().run()}
				class="hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg px-1.5 py-1 text-xs transition-all"
				type="button"
				aria-label={$i18n.t('Add table row')}>+R</button
			>
		</Tooltip>
		<Tooltip placement="top" content={$i18n.t('Delete table row')}>
			<button
				on:click={() => editor?.chain().focus().deleteRow().run()}
				class="hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg px-1.5 py-1 text-xs transition-all"
				type="button"
				aria-label={$i18n.t('Delete table row')}>-R</button
			>
		</Tooltip>
		<Tooltip placement="top" content={$i18n.t('Add table column')}>
			<button
				on:click={() => editor?.chain().focus().addColumnAfter().run()}
				class="hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg px-1.5 py-1 text-xs transition-all"
				type="button"
				aria-label={$i18n.t('Add table column')}>+C</button
			>
		</Tooltip>
		<Tooltip placement="top" content={$i18n.t('Delete table column')}>
			<button
				on:click={() => editor?.chain().focus().deleteColumn().run()}
				class="hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg px-1.5 py-1 text-xs transition-all"
				type="button"
				aria-label={$i18n.t('Delete table column')}>-C</button
			>
		</Tooltip>
	{/if}

	<Tooltip placement="top" content={$i18n.t('Horizontal rule')}>
		<button
			on:click={() => editor?.chain().focus().setHorizontalRule().run()}
			class="hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg p-1.5 transition-all"
			type="button"
			aria-label={$i18n.t('Horizontal rule')}
		>
			<Minus />
		</button>
	</Tooltip>

	<Tooltip placement="top" content={$i18n.t('Highlight')}>
		<button
			on:click={() => editor?.chain().focus().toggleHighlight().run()}
			class="{editor?.isActive('highlight')
				? 'bg-gray-50 dark:bg-gray-700'
				: ''} hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg p-1.5 transition-all"
			type="button"
			aria-label={$i18n.t('Highlight')}
		>
			<Highlighter />
		</button>
	</Tooltip>

	<Tooltip placement="top" content={$i18n.t('Superscript')}>
		<button
			on:click={() => editor?.chain().focus().toggleMark('superscript').run()}
			class="{editor?.isActive('superscript')
				? 'bg-gray-50 dark:bg-gray-700'
				: ''} hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg p-1.5 transition-all"
			type="button"
			aria-label={$i18n.t('Superscript')}
		>
			<Superscript />
		</button>
	</Tooltip>

	<Tooltip placement="top" content={$i18n.t('Subscript')}>
		<button
			on:click={() => editor?.chain().focus().toggleMark('subscript').run()}
			class="{editor?.isActive('subscript')
				? 'bg-gray-50 dark:bg-gray-700'
				: ''} hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg p-1.5 transition-all"
			type="button"
			aria-label={$i18n.t('Subscript')}
		>
			<Subscript />
		</button>
	</Tooltip>

	<EmojiPicker
		onSubmit={(shortCode) => {
			const codepoint = $shortCodesToEmojis[shortCode];
			if (codepoint) {
				const emoji = codepoint
					.split('-')
					.map((cp) => String.fromCodePoint(parseInt(cp, 16)))
					.join('');
				editor?.chain().focus().insertContent(emoji).run();
			}
		}}
	>
		<Tooltip placement="top" content={$i18n.t('Emoji')}>
			<button
				class="hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg p-1.5 transition-all"
				type="button"
			>
				<FaceSmile className="size-4" />
			</button>
		</Tooltip>
	</EmojiPicker>
</div>
