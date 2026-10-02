<script lang="ts">
	import { untrack, type Component } from 'svelte';
	import { setFolderViewer, type FolderViewer } from '$lib/stores/folder-view.svelte';

	// Test harness (ADR-0051 §6): a component below "Ansehen" of the files of folders, as the (app)
	// layout provides it to the inbox panel and the sources of a ticket.
	let {
		viewer,
		component,
		props
	}: {
		viewer: FolderViewer;
		/** Any component; its props come in `props`. */
		component: Component<never>;
		props: Record<string, unknown>;
	} = $props();

	setFolderViewer(untrack(() => viewer));
	const Inner = $derived(component as unknown as Component<Record<string, unknown>>);
</script>

<Inner {...props} />
