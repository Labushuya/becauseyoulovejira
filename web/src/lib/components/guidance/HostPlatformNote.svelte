<script lang="ts">
	import { DEFAULT_HOST_PLATFORM, hostGuideNote } from '$lib/domain/host-platform';
	import { appContext } from '$lib/stores/context.svelte';
	import { findHostStore } from '$lib/stores/host.svelte';
	import SectionMessage from './SectionMessage.svelte';

	// Note above the guides that name setx, start.bat and neu-starten.bat (ADR-0028, plan plattformen
	// S0-3): shown only when the server runs on another system than Windows, and only to the
	// administrator on the machine of the app (KOB-1, ADR-0057), the one who sees those guides. On
	// Windows, elsewhere and outside the (app) layout, nothing is rendered.
	let { headingLevel = 3 }: { headingLevel?: 3 | 4 } = $props();

	const host = findHostStore();
	const note = $derived(
		appContext.capabilities.pc ? hostGuideNote(host?.platform ?? DEFAULT_HOST_PLATFORM) : null
	);
</script>

{#if note !== null}
	<SectionMessage tone="info" title={note.title} {headingLevel}>{note.text}</SectionMessage>
{/if}
