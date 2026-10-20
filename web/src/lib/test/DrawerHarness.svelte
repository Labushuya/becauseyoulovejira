<script lang="ts">
	import type { ResolvedPathname } from '$app/types';
	import Drawer from '$lib/components/overlay/Drawer.svelte';

	// Test harness for the side panel building block (drawer.test.ts): a title, a text field, a
	// field that consumes Escape like a field in edit mode, an action in the header and a footer.
	// `backLabel` and `onback` name and run the arrow back of the phone frame (MO-4).
	let {
		onclose,
		onkeydown,
		closeFromFields = false,
		fullViewHref = null,
		backLabel,
		onback
	}: {
		onclose: () => void;
		onkeydown?: (event: KeyboardEvent) => void;
		closeFromFields?: boolean;
		fullViewHref?: ResolvedPathname | null;
		backLabel?: string;
		onback?: () => void;
	} = $props();
</script>

<Drawer
	labelledby="harness-title"
	{onclose}
	{onkeydown}
	{closeFromFields}
	{fullViewHref}
	{backLabel}
	{onback}
>
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
