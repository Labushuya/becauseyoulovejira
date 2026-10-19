<script lang="ts">
	// The search field above a list of sources (QS-2, ADR-0031 addendum N): the section "Quellen" of
	// a ticket and the choice of new entries of the inbox. The field of base.css (.search-field) with
	// a label for screen readers and the magnifier, next to it what the search found ("3 von 12",
	// the field's description), said in a polite live region once typing pauses, like the filter of
	// ChipList and the ticket picker. Escape empties a field that is not empty and is consumed; an
	// empty one leaves Escape to the panel or dialog around it. The owner filters (`searchWords`) and
	// names the hits; `onsearch` follows every change by the user, Escape included.
	let {
		query = $bindable(''),
		label,
		placeholder,
		count,
		announcement,
		controls,
		input = $bindable(),
		onsearch
	}: {
		query?: string;
		/** Name of the field for screen readers, e.g. "Quellen durchsuchen". */
		label: string;
		placeholder: string;
		/** What the search found, shown next to the field ("3 von 12"); '' shows nothing. */
		count: string;
		/** What is said once typing pauses: the hits or the empty result; '' says nothing. */
		announcement: string;
		/** IDs of the lists the search narrows. */
		controls?: string;
		/** The field, for the owner to put the focus back into it. */
		input?: HTMLInputElement;
		onsearch?: () => void;
	} = $props();

	/** Pause before the hits are said, so typing is not talked over (as ChipList and TicketPicker). */
	const ANNOUNCE_DELAY_MS = 500;

	const uid = $props.id();
	const ids = { field: `${uid}-field`, count: `${uid}-count` };

	let said = $state('');

	$effect(() => {
		const text = announcement;
		const timer = setTimeout(() => (said = text), ANNOUNCE_DELAY_MS);
		return () => clearTimeout(timer);
	});

	function onkeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || query === '') return;
		event.preventDefault();
		event.stopPropagation();
		query = '';
		onsearch?.();
	}
</script>

<div class="list-search">
	<div class="search-field">
		<label for={ids.field}>
			<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
				<circle cx="7" cy="7" r="4.25" />
				<path d="M10.25 10.25L13.5 13.5" />
			</svg>
			<span class="visually-hidden">{label}</span>
		</label>
		<input
			id={ids.field}
			type="search"
			autocomplete="off"
			spellcheck="false"
			{placeholder}
			aria-controls={controls}
			aria-describedby={count === '' ? undefined : ids.count}
			bind:value={query}
			bind:this={input}
			oninput={() => onsearch?.()}
			{onkeydown}
		/>
	</div>
	{#if count !== ''}
		<span class="count" id={ids.count}>{count}</span>
	{/if}
	<p class="visually-hidden" aria-live="polite">{said}</p>
</div>

<style>
	/* In a row with other tools it takes the free space, so they stand at the end. */
	.list-search {
		display: flex;
		flex: 1 1 16rem;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
		align-items: center;
		min-width: 0;
		max-width: 100%;
	}

	.search-field {
		width: min(16rem, 100%);
	}

	.search-field input {
		width: 100%;
	}

	.count {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}
</style>
