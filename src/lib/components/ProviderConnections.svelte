<script lang="ts">
	import ProviderServices from '$lib/components/providers/ProviderServices.svelte';

	export let mode: 'personal' | 'admin' = 'personal';
</script>

<ProviderServices {mode} />
