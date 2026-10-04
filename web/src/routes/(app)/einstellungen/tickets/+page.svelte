<script lang="ts">
	import SectionMessage from '$lib/components/guidance/SectionMessage.svelte';
	import RetentionChoice from '$lib/components/RetentionChoice.svelte';
	import { retentionText } from '$lib/domain/trash';
	import { restartNeeded } from '$lib/guidance/texts';
	import { getTrashStore } from '$lib/stores/trash.svelte';
	import { trashHref } from '$lib/ticket-links';

	// Settings "Tickets" (ADR-0037 §8): how long deleted tickets stay in the trash before they are
	// deleted for good, 7, 30 (default) or 90 days or never. Stored with the account on the server
	// (users.trash_retention), because the daily run needs it without an open tab; a choice applies
	// at once, the flag confirms it. Since E7-3 (ADR-0059 §6) it is the retention of the private
	// trash only; a household has its own on the page "Haushalt". Before the migration of the trash
	// the page says when it comes.
	const store = getTrashStore();
</script>

<svelte:head>
	<title>Tickets · Einstellungen · becauseyoulovejira</title>
</svelte:head>

{#if store.state === 'unavailable'}
	<SectionMessage tone="info">{restartNeeded('Der Papierkorb ist')}</SectionMessage>
{:else}
	<RetentionChoice
		legend="Papierkorb"
		value={store.ownRetention}
		disabled={store.state !== 'ready'}
		busy={store.state === 'loading'}
		onchoose={(value) => void store.setRetention(value)}
	>
		{#snippet note()}
			Gelöschte Tickets liegen im <a href={trashHref()}>Papierkorb</a> und lassen sich dort
			wiederherstellen.
			{retentionText(store.ownRetention)} Die Frist zählt ab dem Tag des Löschens und gilt für deine privaten
			Tickets; im Haushalt gilt die Einstellung des Haushalts.
		{/snippet}
	</RetentionChoice>
{/if}
