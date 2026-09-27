<script lang="ts">
	import { renderMarkdown } from '$lib/markdown';

	// Rendered Markdown (ADR-0008). The only raw HTML output of the app; it shows nothing but the output
	// of renderMarkdown, which parses without raw HTML and sanitizes the result.
	// With `ontoggletask` the checkboxes of its tasks can be ticked (ADR-0032 section 6): they are
	// enabled in the DOM after rendering, and one change handler on the container takes them (no
	// second raw HTML output). While a change is saved, the ticked box is aria-busy and every box is locked
	// with aria-disabled, like the check mark of a row; with `taskHint` they are locked and say why.
	let {
		source,
		ontoggletask,
		taskHint = null
	}: {
		source: string;
		/** Saves the new state of task `index`; false puts the box back. */
		ontoggletask?: (index: number, checked: boolean) => Promise<boolean>;
		/** Why the tasks cannot be ticked right now; null lets them be ticked. */
		taskHint?: string | null;
	} = $props();

	const uid = $props.id();
	const hintId = `${uid}-task-hint`;

	const html = $derived(renderMarkdown(source));

	let container = $state<HTMLDivElement>();
	/** Index of the task being saved. */
	let pending = $state<number | null>(null);

	const locked = $derived(pending !== null || taskHint !== null);

	/** The checkbox of a task and its index, or null for any other element. */
	function taskOf(target: EventTarget | null): { box: HTMLInputElement; index: number } | null {
		if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') return null;
		const index = Number(target.closest('li[data-task]')?.getAttribute('data-task'));
		return Number.isInteger(index) ? { box: target, index } : null;
	}

	/** Sets an ARIA state to "true" or removes it. */
	function setFlag(element: Element, name: string, on: boolean): void {
		if (on) element.setAttribute(name, 'true');
		else element.removeAttribute(name);
	}

	$effect(() => {
		// Runs after every render of the HTML, which brings new, disabled checkboxes.
		void html;
		const root = container;
		if (root === undefined || ontoggletask === undefined) return;
		for (const input of root.querySelectorAll('input')) {
			const task = taskOf(input);
			if (task === null) continue;
			input.disabled = false;
			setFlag(input, 'aria-disabled', locked);
			setFlag(input, 'aria-busy', task.index === pending);
			if (taskHint === null) input.removeAttribute('aria-describedby');
			else input.setAttribute('aria-describedby', hintId);
		}
	});

	async function onchange(event: Event) {
		const task = taskOf(event.target);
		if (task === null || ontoggletask === undefined) return;
		const { box, index } = task;
		const checked = box.checked;
		if (locked) {
			box.checked = !checked;
			return;
		}
		pending = index;
		const saved = await ontoggletask(index, checked);
		pending = null;
		if (!saved && box.isConnected) box.checked = !checked;
	}
</script>

<div class="markdown" bind:this={container} {onchange}>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized by renderMarkdown (ADR-0008) -->
	{@html html}
</div>
{#if ontoggletask !== undefined && taskHint !== null}
	<p class="visually-hidden" id={hintId}>{taskHint}</p>
{/if}

<style>
	.markdown {
		min-width: 0;
		font-size: var(--font-size-body);
		line-height: 1.55;
		overflow-wrap: anywhere;
	}

	.markdown :global(:where(p, ul, ol, pre, blockquote, table, hr, h1, h2, h3, h4, h5, h6)) {
		margin-bottom: 0.625rem;
	}

	.markdown :global(:last-child) {
		margin-bottom: 0;
	}

	.markdown :global(:where(h1, h2, h3, h4, h5, h6)) {
		font-weight: 600;
		line-height: 1.3;
	}

	.markdown :global(h1) {
		font-size: 1.25rem;
	}

	.markdown :global(h2) {
		font-size: var(--font-size-title);
	}

	.markdown :global(:where(h3, h4, h5, h6)) {
		font-size: 1rem;
	}

	.markdown :global(:where(ul, ol)) {
		padding-left: 1.5rem;
	}

	/*
	 * Tasks (ADR-0032): the checkbox takes the place of the bullet. base.css draws it; here it only
	 * gets its place in the line, also in loose lists where it sits in the first paragraph.
	 */
	.markdown :global(li[data-task]) {
		list-style: none;
	}

	.markdown :global(:where(li[data-task] > input, li[data-task] > p:first-child > input)) {
		margin: 0 0.375rem 0 -1.375rem;
		vertical-align: -0.125rem;
	}

	.markdown :global(a) {
		color: var(--color-brand-text);
	}

	.markdown :global(code) {
		padding: 0.0625rem 0.25rem;
		font-size: var(--font-size-control);
		background: var(--color-bg);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-item);
	}

	.markdown :global(pre) {
		max-width: 100%;
		padding: 0.5rem 0.75rem;
		overflow-x: auto;
		background: var(--color-bg);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
	}

	.markdown :global(pre code) {
		padding: 0;
		background: none;
		border: none;
	}

	.markdown :global(blockquote) {
		padding-left: 0.75rem;
		color: var(--color-text-muted);
		border-left: 3px solid var(--color-line);
	}

	/* Wide tables from Markdown scroll inside their block instead of widening the panel. */
	.markdown :global(table) {
		display: block;
		max-width: 100%;
		overflow-x: auto;
		border-collapse: collapse;
	}

	.markdown :global(:where(th, td)) {
		padding: 0.25rem 0.5rem;
		text-align: left;
		border: 1px solid var(--color-line);
	}

	.markdown :global(hr) {
		border: none;
		border-top: 1px solid var(--color-line);
	}
</style>
