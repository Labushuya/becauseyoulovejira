<script lang="ts">
	import AreaSwitch from '$lib/components/AreaSwitch.svelte';
	import { setAreaStore, type AreaStore } from '$lib/stores/area.svelte';

	// Tests: the area switch with an area store in the context, as the (app) layout gives it (E7-3).
	let { store }: { store: AreaStore } = $props();
	// svelte-ignore state_referenced_locally
	setAreaStore(store);
</script>

<AreaSwitch />
