<script lang="ts">
	import type { ResolvedPathname } from '$app/types';
	import Drawer from '$lib/components/overlay/Drawer.svelte';

	// Test harness for the side panel building block (drawer.test.ts): a title, a text field, a
	// field that consumes Escape like a field in edit mode, an action in the header and a footer.
	let {
		onclose,
		onkeydown,
		closeFromFields = false,
		fullViewHref = null
	}: {
		onclose: () => void;
		onkeydown?: (event: KeyboardEvent) => void;
		closeFromFields?: boolean;
		fullViewHref?: ResolvedPathname | null;
	} = $props();
</script>

<Drawer labelledby="harness-title" {onclose} {onkeydown} {closeFromFields} {fullViewHref}>
	{#snippet context()}<span>TASK-7</span>{/snippet}
	{#snippet actions()}<button type="button">Löschen …</button>{/snippet}
	{#snippet footer()}<button type="button">Anlegen</button>{/snippet}
	<h2 id="harness-title" tabindex="-1">Steuer abgeben</h2>
	<label>Notiz <input type="text" /></label>
	<label>
		Titel im Bearbeitungsmodus
		<input
			type="text"
			onkeydown={(event) => {
				if (event.key === 'Escape') event.preventDefault();
			}}
		/>
	</label>
</Drawer>
