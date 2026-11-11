<script lang="ts">
	/**
	 * The inferred migration is gone.
	 *
	 * It guessed which connection corresponded to a legacy block by comparing a
	 * full endpoint against a base URL and a decrypted key byte-for-byte, so it
	 * could never match a shared connection; when it did fire it wrote a private
	 * one that every other user then got a 403 from. Repairing the guess was the
	 * wrong move — assignment is explicit now — so this notice points there
	 * instead of offering a button that answers 410.
	 */
	export let purposes: string[] = [];

	const labels: Record<string, string> = {
		transcription: '语音转写',
		speech: '语音合成',
		image: '生图',
		realtime: '实时语音'
	};

	$: covered = purposes.map((purpose) => labels[purpose] ?? purpose).join(' / ');
</script>

<div
	class="rounded-xl border border-gray-100 p-3 text-xs text-gray-500 dark:border-gray-850 dark:text-gray-400"
>
	{#if covered}
		<p>{covered}已统一到「服务商连接」出口。</p>
	{/if}
	<p class="mt-1">
		自动迁移已退役：它按地址与密钥逐字比对推断目标连接，无法匹配共享连接，且会把全实例用途写成私有连接。请在「管理员设置 → 媒体出口」里显式指派连接与模型。
	</p>
</div>
