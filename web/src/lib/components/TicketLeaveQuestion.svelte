<script lang="ts">
	import { onMount } from 'svelte';
	import SectionMessage from './guidance/SectionMessage.svelte';

	// "Änderungen verwerfen?" in the full view (open point of the sub-tasks plan): the full view is
	// a modal, and no dialog opens from a dialog (ADR-0025 section 3), so the question about unsaved
	// text stands inline at the top of its content when a link leaves the ticket, with the words of
	// the confirmation of the panel. The focus starts on "Weiter bearbeiten"; that and Escape (which
	// is consumed, so the full view stays) return the focus to where it was, usually the link. The
	// panels of projects and rules ask the same inline when a link replaces them (ADR-0054 §7),
	// with the words of their own confirmation (`title`, `text`).
	let {
		title = 'Änderungen verwerfen?',
		text = 'Der nicht gespeicherte Text geht verloren.',
		onstay,
		ondiscard
	}: {
		title?: string;
		text?: string;
		onstay: () => void;
		ondiscard: () => void;
	} = $props();

	let stayButton = $state<HTMLButtonElement>();
	/** Element that had the focus when the question opened. */
	let origin: HTMLElement | null = null;

	onMount(() => {
		origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		stayButton?.focus();
	});

	function stay() {
		const target = origin;
		onstay();
		if (target !== null && target.isConnected) target.focus();
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || event.defaultPrevented) return;
		event.preventDefault();
		event.stopPropagation();
		stay();
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="question" role="group" aria-label={title} {onkeydown}>
	<SectionMessage tone="warning" {title}>
		<p>{text}</p>
		{#snippet actions()}
			<button class="button-secondary" type="button" bind:this={stayButton} onclick={stay}>
				Weiter bearbeiten
			</button>
			<button class="button-primary" type="button" onclick={ondiscard}>Verwerfen</button>
		{/snippet}
	</SectionMessage>
</div>
