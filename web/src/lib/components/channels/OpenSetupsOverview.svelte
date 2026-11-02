<script lang="ts">
	import type { ResolvedPathname } from '$app/types';
	import {
		OPEN_SETUP_TEXTS,
		continuesAtPc,
		openSetupLine,
		type OpenSetupEntry
	} from '$lib/domain/open-setups';
	import SectionMessage from '../guidance/SectionMessage.svelte';

	// Overview "N Einrichtungen offen" above the cards of the page "Kanäle" (KE-1, ADR-0076 §2): one
	// entry per begun setup with an open mandatory step, its name, the step ("Schritt 5 von 7: Wartet
	// auf Neustart") and "Fortsetzen", a link to the assistant at that step (the own inbox has none:
	// "Zur Karte"). On another device of the administrator a step that needs the PC says "am PC
	// fortsetzen". A section message (ADR-0026 §2), not live: it stands while setups are open. The
	// list keeps one column of text that wraps, the link below it where the line is narrow (360 px,
	// no horizontal scrolling); in the phone frame the link is a target of 44 px through its button
	// style (MO-1b). Reusable for the overview of the settings (EU-1).
	let {
		entries,
		remote = false,
		hrefOf,
		onfollow
	}: {
		entries: readonly OpenSetupEntry[];
		/** The tab is another device of the administrator. */
		remote?: boolean;
		/** Address of "Fortsetzen" of an entry. */
		hrefOf: (entry: OpenSetupEntry) => ResolvedPathname;
		/** A link of an entry was followed (the page moves the focus to the card of the own inbox). */
		onfollow?: (entry: OpenSetupEntry) => void;
	} = $props();

	const title = $derived(OPEN_SETUP_TEXTS.count(entries.length));

	/** "Schritt 5 von 7: Wartet auf Neustart", on another device "… – am PC fortsetzen". */
	function lineOf(entry: OpenSetupEntry): string {
		const line = openSetupLine(entry);
		return continuesAtPc(entry.open, remote) ? `${line} – ${OPEN_SETUP_TEXTS.atPc}` : line;
	}
</script>

{#if entries.length > 0}
	<div data-open-setups>
		<SectionMessage tone="info" {title}>
			<p>{OPEN_SETUP_TEXTS.intro}</p>
			<ul aria-label={title}>
				{#each entries as entry (entry.key)}
					<li>
						<span class="what"><strong>{entry.name}</strong>: {lineOf(entry)}</span>
						<a
							class="button-secondary button-small"
							href={hrefOf(entry)}
							data-sveltekit-keepfocus
							data-sveltekit-noscroll
							data-sveltekit-replacestate
							onclick={() => onfollow?.(entry)}
						>
							{entry.target === 'own-inbox'
								? OPEN_SETUP_TEXTS.toCard
								: OPEN_SETUP_TEXTS.resume}<span class="visually-hidden">: {entry.name}</span>
						</a>
					</li>
				{/each}
			</ul>
		</SectionMessage>
	</div>
{/if}

<style>
	ul {
		display: grid;
		gap: 0.5rem;
		margin: 0.5rem 0 0;
		padding: 0;
		list-style: none;
	}

	/* Text and link in one line where there is room; the link below the text where not. */
	li {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.75rem;
		align-items: center;
		justify-content: space-between;
	}

	.what {
		flex: 1 1 14rem;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	strong {
		font-weight: 600;
	}

	a {
		flex: none;
		text-decoration: none;
	}
</style>
