<script lang="ts">
	import { tick } from 'svelte';
	import { writeClipboardText } from '$lib/clipboard';
	import GuidanceIcon from '$lib/components/guidance/GuidanceIcon.svelte';
	import { PROBLEM_TEXTS } from '$lib/domain/problems';

	// "Kopieren" of a report of failed actions (FP-1, ADR-0071), like "Kopieren" of a code block
	// (ADR-0026 section 6): the plain text goes to the clipboard, the button says `copied` for 2 s
	// and a status says it once. If the browser refuses, the report shows below as text and is
	// selected, and the status names Ctrl+C. The wrapper has no box of its own (display: contents),
	// so the button stands in the row of its neighbours and the fallback takes a line of its own.
	// No SectionMessage here: it shows these details itself (no cycle of imports).
	let {
		report,
		label,
		copied: copiedText
	}: {
		/** The text to copy, read on the click (the list may have changed). */
		report: () => string;
		/** "Kopieren" or "Alle kopieren". */
		label: string;
		/** "Kopiert." or "Alle kopiert.". */
		copied: string;
	} = $props();

	const COPIED_MS = 2000;

	let copied = $state(false);
	let failed = $state<string | null>(null);
	let status = $state('');
	let fallback = $state<HTMLElement>();
	let timer: ReturnType<typeof setTimeout> | undefined;

	$effect(() => () => clearTimeout(timer));

	function selectFallback() {
		const selection = typeof window === 'undefined' ? null : window.getSelection();
		if (!fallback || !selection) return;
		const range = document.createRange();
		range.selectNodeContents(fallback);
		selection.removeAllRanges();
		selection.addRange(range);
	}

	async function copy() {
		const text = report();
		failed = null;
		if (await writeClipboardText(text)) {
			copied = true;
			status = copiedText;
			clearTimeout(timer);
			timer = setTimeout(() => {
				copied = false;
				status = '';
			}, COPIED_MS);
			return;
		}
		copied = false;
		status = PROBLEM_TEXTS.copyFailed;
		failed = text;
		await tick();
		selectFallback();
	}
</script>

<div class="copy-report">
	<button class="button-subtle" type="button" onclick={copy}>
		{#if copied}
			<GuidanceIcon name="check" size={14} />{copiedText}
		{:else}
			{label}
		{/if}
	</button>
	<span class="visually-hidden" role="status">{status}</span>
	{#if failed !== null}
		<div class="fallback">
			<p class="hint" aria-hidden="true">{PROBLEM_TEXTS.copyFailed}</p>
			<pre bind:this={fallback}>{failed}</pre>
		</div>
	{/if}
</div>

<style>
	.copy-report {
		display: contents;
	}

	button {
		gap: 0.25rem;
	}

	.fallback {
		display: grid;
		flex-basis: 100%;
		gap: 0.375rem;
		min-width: 0;
	}

	.hint {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}

	pre {
		max-width: 100%;
		margin: 0;
		padding: 0.5rem 0.625rem;
		font-family: var(--font-mono);
		font-size: var(--font-size-small);
		line-height: 1.5;
		color: var(--color-text);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		background: var(--color-bg);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
	}
</style>
