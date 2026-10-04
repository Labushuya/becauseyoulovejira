<script lang="ts">
	import type { Snippet } from 'svelte';
	import { contextNote, type ContextNeed } from '$lib/domain/context';
	import { contextNoteText } from '$lib/guidance/texts';
	import { appContext } from '$lib/stores/context.svelte';
	import SectionMessage from './SectionMessage.svelte';

	// What works only at the machine of the app (KX-1, ADR-0057): commands, .bat files, setx, the
	// Explorer, folders of that machine. The content shows for the administrator there ("script":
	// on a server under Windows); everywhere else the same hint stands instead: "nur am PC" for the
	// administrator on another device, "Bitte den Verwalter fragen." (or `member`) for every other
	// account, "Auf diesem Server nicht verfügbar." for the scripts elsewhere, "nach dem nächsten
	// Neustart" before the restart. While the context loads, nothing shows, so nothing flashes.
	let {
		need = 'pc',
		inline = false,
		quiet = false,
		member,
		children
	}: {
		/** "pc": the machine of the app; "script": its scripts (.bat, byl-control.ps1) as well. */
		need?: ContextNeed;
		/** Within a sentence or a list item: plain text instead of a section message. */
		inline?: boolean;
		/** Nothing instead, where a hint nearby says it already. */
		quiet?: boolean;
		/** Text for every other account instead of "Bitte den Verwalter fragen.". */
		member?: string;
		children: Snippet;
	} = $props();

	const capabilities = $derived(appContext.capabilities);
	const note = $derived(contextNote(capabilities, need));
	const text = $derived(
		note === null || quiet
			? ''
			: note === 'ask-admin' && member !== undefined
				? member
				: contextNoteText(note, capabilities.localUrl)
	);
</script>

{#if note === null}
	{@render children()}
{:else if text !== ''}
	{#if inline}
		<span class="pc-only">{text}</span>
	{:else}
		<SectionMessage tone="info" compact>{text}</SectionMessage>
	{/if}
{/if}

<style>
	.pc-only {
		color: var(--color-text-muted);
	}
</style>
