<script lang="ts">
	type Props = {
		label: string;
		min?: number;
		max?: number;
		step?: number;
		value?: number;
		suffix?: string;
		class?: string;
	};

	let {
		label,
		min = 0,
		max = 100,
		step = 1,
		value = $bindable(0),
		suffix = '',
		class: className = ''
	}: Props = $props();
</script>

<label class={`mist-range-control ${className}`}>
	<span>
		{label}
		<span class="mist-range-control__value">{value}{suffix}</span>
	</span>
	<input class="mist-range mist-focusable" type="range" bind:value {min} {max} {step} />
</label>
