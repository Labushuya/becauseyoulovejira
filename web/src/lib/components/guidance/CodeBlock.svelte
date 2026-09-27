<script lang="ts">
	import { writeClipboardText } from '$lib/clipboard';
	import {
		SECRET_MASK,
		parseTemplate,
		renderCommand,
		type PlaceholderInfo
	} from '$lib/guidance/command';
	import GuidanceIcon from './GuidanceIcon.svelte';
	import SectionMessage from './SectionMessage.svelte';

	// Code block of the guides (ADR-0026 section 6, ADS pattern "code block", plan EH-4): a figure
	// with caption and preformatted code in the mono font that scrolls with the keyboard (region
	// with a name), placeholders in ‹angle quotes› with a dashed frame and a hidden "Platzhalter:"
	// for screen readers, and "Kopieren". A copy shows "Kopiert" for 2 s and says so as status;
	// if the browser refuses, the code is selected and the hint names Ctrl+C. No flag, so nothing is
	// said twice. `values` fill placeholders (EH-5); secret ones are masked in the display only.
	let {
		code,
		label,
		placeholders = {},
		values = {},
		copyable = true,
		wrap = false,
		oncopied
	}: {
		/** Code, with placeholders as {{name}}. */
		code: string;
		/** Caption and name of the region, e.g. "Befehl für die Eingabeaufforderung". */
		label: string;
		placeholders?: Readonly<Record<string, PlaceholderInfo>>;
		values?: Readonly<Record<string, string>>;
		copyable?: boolean;
		/** Wrap long lines (e.g. the bookmarklet) instead of scrolling sideways. */
		wrap?: boolean;
		/** After a successful copy, e.g. to empty the field "Wert hier einsetzen" (EH-5). */
		oncopied?: () => void;
	} = $props();

	/** How long the button says "Kopiert". */
	const COPIED_MS = 2000;

	const segments = $derived(parseTemplate(code, placeholders));
	const rendered = $derived(renderCommand(segments, values));

	let pre = $state<HTMLElement>();
	let copied = $state(false);
	let failed = $state(false);
	let status = $state('');
	let timer: ReturnType<typeof setTimeout> | undefined;

	$effect(() => () => clearTimeout(timer));

	function selectCode() {
		const selection = typeof window === 'undefined' ? null : window.getSelection();
		if (!pre || !selection) return;
		const range = document.createRange();
		range.selectNodeContents(pre);
		selection.removeAllRanges();
		selection.addRange(range);
	}

	async function copy() {
		failed = false;
		if (await writeClipboardText(rendered.copy)) {
			copied = true;
			status = `${label} kopiert.`;
			clearTimeout(timer);
			timer = setTimeout(() => {
				copied = false;
				status = '';
			}, COPIED_MS);
			oncopied?.();
			return;
		}
		copied = false;
		status = '';
		failed = true;
		selectCode();
	}
</script>

<figure class="code-block">
	<figcaption>
		<span class="caption">{label}</span>
		{#if copyable}
			<button
				class="button-subtle copy"
				type="button"
				aria-label={`${label} kopieren`}
				onclick={copy}
			>
				{#if copied}
					<GuidanceIcon name="check" size={14} />Kopiert
				{:else}
					Kopieren
				{/if}
			</button>
		{/if}
	</figcaption>
	<!-- A named region with tabindex 0: it scrolls with the keyboard (ADS, WCAG 2.1.1). -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<pre class:wrap tabindex="0" role="region" aria-label={label} bind:this={pre}><code
			>{#each segments as segment, index (index)}{#if segment.kind === 'text'}{segment.text}{:else if values[segment.name]}{segment.secret
						? SECRET_MASK
						: values[segment.name]}{:else}<span class="placeholder"
						><span class="visually-hidden">Platzhalter: </span>‹{segment.label}›</span
					>{/if}{/each}</code
		></pre>
	<p class="visually-hidden" role="status">{status}</p>
	{#if failed}
		<SectionMessage tone="info" compact live>
			Kopieren war nicht möglich. Der Code ist markiert: mit Strg+C kopieren.
		</SectionMessage>
	{/if}
</figure>

<style>
	.code-block {
		display: grid;
		gap: 0.375rem;
		min-width: 0;
		margin: 0;
	}

	figcaption {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		justify-content: space-between;
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}

	.copy {
		gap: 0.25rem;
		padding: 0.125rem 0.5rem;
		font-size: 0.8125rem;
	}

	pre {
		max-width: 100%;
		margin: 0;
		padding: 0.625rem 0.75rem;
		overflow-x: auto;
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--color-text);
		background: var(--color-bg);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
	}

	pre.wrap {
		white-space: pre-wrap;
		word-break: break-all;
	}

	/* Placeholder: dashed frame in the brand colour, text "Marke Fläche / Text darauf". */
	.placeholder {
		padding: 0 0.25rem;
		color: var(--color-brand-soft-text);
		background: var(--color-brand-soft-bg);
		border: 1px dashed var(--color-brand);
		border-radius: var(--radius-item);
	}
</style>
