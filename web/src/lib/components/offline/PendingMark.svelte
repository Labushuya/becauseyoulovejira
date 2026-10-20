<script lang="ts">
	import { OFFLINE_TEXTS } from '$lib/domain/offline';
	import { findOutbox, type OutboxStore } from '$lib/offline/outbox.svelte';
	import OfflineIcon from './OfflineIcon.svelte';

	// The mark "Noch nicht übertragen" of the outbox (OF-2, concept OF-0 §2.3) at a row, a card, the
	// panel and a sub-task: a small cloud with an arrow in the muted color of the text (the concept
	// names --color-text-subtle, which tokens.css does not have), never a color of its own, with
	// `title` and a hidden text for screen readers. A change that waits for a decision (conflict,
	// refusal, older than 48 hours) says "Entscheidung nötig" in the color of the text instead.
	// Without the outbox of the layout (tests of single parts) nothing shows.
	let { id, outbox = findOutbox() }: { id: string; outbox?: OutboxStore | null } = $props();

	const mark = $derived(outbox?.markOf(id) ?? null);
	const text = $derived(mark === 'decision' ? OFFLINE_TEXTS.markDecision : OFFLINE_TEXTS.mark);
</script>

{#if mark !== null}
	<span class="pending-mark" class:decision={mark === 'decision'} title={text}
		><OfflineIcon /><span class="visually-hidden">, {text}</span></span
	>
{/if}

<style>
	.pending-mark {
		display: inline-flex;
		align-items: center;
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
		vertical-align: middle;
	}

	.decision {
		color: var(--color-text);
	}
</style>
