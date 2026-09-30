<script lang="ts">
	import { collapseLimit } from '$lib/domain/comments';
	import Markdown from './Markdown.svelte';

	// Text of a comment that folds when it is long (ADR-0044 section 3): measured on the rendered
	// text, so images, lists and code count. A text higher than 14 lines shows 12 of them, fades out
	// at the end and offers "Weiterlesen" / "Weniger anzeigen" (aria-expanded). The whole text stays
	// in the DOM for screen readers; focus that lands in the hidden part unfolds it. A
	// ResizeObserver watches the inner text, whose height never depends on the folding, so there
	// is no loop; its first report comes after the layout and before the first paint, so a long
	// comment appears folded at once, and it decides again when the text grows (an image, a wider
	// panel). Without a ResizeObserver (jsdom) nothing folds.
	let {
		source,
		ontoggletask,
		taskHint = null,
		expanded,
		onexpandedchange,
		name
	}: {
		source: string;
		ontoggletask?: (index: number, checked: boolean) => Promise<boolean>;
		taskHint?: string | null;
		/** Unfolded in this tab. */
		expanded: boolean;
		onexpandedchange: (expanded: boolean) => void;
		/** Names the comment on the button, e.g. "Kommentar von Du vom 24.09.2026 12:00". */
		name: string;
	} = $props();

	const uid = $props.id();
	const textId = `${uid}-text`;

	let clip = $state<HTMLDivElement>();
	let inner = $state<HTMLDivElement>();
	/** Height of the folded text in pixels; null: the text is short enough to stay whole. */
	let limit = $state<number | null>(null);

	const folded = $derived(limit !== null && !expanded);

	$effect(() => {
		const element = inner;
		if (element === undefined || typeof ResizeObserver === 'undefined') return;
		const measure = () => {
			const text = element.firstElementChild ?? element;
			const lineHeight = Number.parseFloat(getComputedStyle(text).lineHeight);
			limit = collapseLimit(element.offsetHeight, lineHeight);
		};
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	});

	/** Keyboard focus on a link or task below the fold unfolds the text, so it is seen. */
	function onfocusin(event: FocusEvent) {
		if (!folded || limit === null || clip === undefined) return;
		if (!(event.target instanceof Element)) return;
		const top = clip.getBoundingClientRect().top;
		if (event.target.getBoundingClientRect().bottom - top > limit) onexpandedchange(true);
	}
</script>

<div
	class="clip"
	class:fade-end={folded}
	id={textId}
	style:max-height={folded ? `${limit}px` : undefined}
	bind:this={clip}
	{onfocusin}
>
	<div bind:this={inner}>
		<Markdown {source} {ontoggletask} {taskHint} />
	</div>
</div>
{#if limit !== null}
	<button
		class="button-subtle more"
		type="button"
		aria-expanded={expanded}
		aria-controls={textId}
		onclick={() => onexpandedchange(!expanded)}
	>
		{expanded ? 'Weniger anzeigen' : 'Weiterlesen'}<span class="visually-hidden">: {name}</span>
	</button>
{/if}

<style>
	/* Folded, it carries .fade-end of base.css: the last lines fade out. */
	.clip {
		min-width: 0;
	}

	.more {
		justify-self: start;
		font-size: var(--font-size-small);
	}
</style>
