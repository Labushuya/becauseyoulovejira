<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { ticketIdOfLink } from '$lib/domain/link';
	import { renderMarkdown } from '$lib/markdown';
	import { ticketLinks } from '$lib/stores/open-mode.svelte';

	// Rendered Markdown (ADR-0008). The only raw HTML output of the app; it shows nothing but the output
	// of renderMarkdown, which parses without raw HTML and sanitizes the result.
	// With `ontoggletask` the checkboxes of its tasks can be ticked (ADR-0032 section 6): they are
	// enabled in the DOM after rendering, and one change handler on the container takes them (no
	// second raw HTML output). While a change is saved, the ticked box is aria-busy and every box is locked
	// with aria-disabled, like the check mark of a row; with `taskHint` they are locked and say why.
	// The look comes from lib/styles/prose.css, shared with the editor (plan editor section 3.3).
	// Links to a ticket of the app (`/tickets/<id>`, ADR-0042 §5) open where the text stands, in the
	// remembered way (ADR-0054 §7): one click handler on the container takes a plain click with the
	// main button (Enter on a link is such a click) and goes through `ticketLinks()`. With a modifier
	// or another button the link stays as stored, which a new tab and the server understand.
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
	const links = ticketLinks();

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

	/** A plain click on a link to a ticket opens it in the current place (ADR-0054 §7). */
	function onclick(event: MouseEvent) {
		if (event.defaultPrevented || event.button !== 0) return;
		if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
		const link = event.target instanceof Element ? event.target.closest('a') : null;
		if (link === null || container === undefined || !container.contains(link)) return;
		const id = ticketIdOfLink(link.getAttribute('href'));
		if (id === null) return;
		event.preventDefault();
		void goto(links.href(id, page.url));
	}
</script>

<!-- The clicks come from the links inside (Enter on a link is a click), which stay reachable. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="markdown prose" bind:this={container} {onchange} {onclick}>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized by renderMarkdown (ADR-0008) -->
	{@html html}
</div>
{#if ontoggletask !== undefined && taskHint !== null}
	<p class="visually-hidden" id={hintId}>{taskHint}</p>
{/if}
