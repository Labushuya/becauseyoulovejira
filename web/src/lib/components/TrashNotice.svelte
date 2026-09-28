<script lang="ts">
	import { findTrashStore } from '$lib/stores/trash.svelte';
	import { trashItemHref } from '$lib/ticket-links';
	import SectionMessage from './guidance/SectionMessage.svelte';

	// A link to a ticket that is in the trash (ADR-0037 §3): the API does not show it any more, so
	// the panel would only say "nicht gefunden". This neutral hint says where it is and leads to its
	// preview. It asks the trash of the (app) layout: first its list, then (for a sub-task of a
	// group, which the list does not show) the preview route. Without the store (tests of single
	// components) or when the ticket is not in the trash it shows nothing.
	let {
		id,
		title = 'Dieses Ticket liegt im Papierkorb'
	}: {
		/** ID of the ticket; null shows nothing. */
		id: string | null;
		title?: string;
	} = $props();

	const trash = findTrashStore();
	let inTrash = $state(false);

	$effect(() => {
		const current = id;
		inTrash = false;
		if (trash === null || current === null) return;
		if (trash.find(current) !== null) {
			inTrash = true;
			return;
		}
		const controller = new AbortController();
		trash
			.preview(current, controller.signal)
			.then((preview) => {
				if (!controller.signal.aborted) inTrash = preview !== null;
			})
			.catch(() => undefined);
		return () => controller.abort();
	});
</script>

{#if inTrash && id !== null}
	<SectionMessage tone="info" {title}>
		<p>Dort lässt es sich ansehen und wiederherstellen.</p>
		{#snippet actions()}
			<a href={trashItemHref(id)}>Im Papierkorb ansehen</a>
		{/snippet}
	</SectionMessage>
{/if}
