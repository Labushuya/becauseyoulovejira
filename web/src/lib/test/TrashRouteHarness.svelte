<script lang="ts">
	import TrashLayout from '../../routes/(app)/papierkorb/+layout.svelte';
	import TrashItemPage from '../../routes/(app)/papierkorb/[id]/+page.svelte';

	// Test harness of /papierkorb and /papierkorb/<id> (trash-route.test.ts, ADR-0037 §9, ADR-0054
	// §7): the layout with the table and, as its child page, the preview of a ticket, as SvelteKit
	// renders it.
	let { preview = false }: { preview?: boolean } = $props();
</script>

<TrashLayout>
	{#if preview}
		<TrashItemPage />
	{/if}
</TrashLayout>
