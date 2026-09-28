<script lang="ts">
	import { tick } from 'svelte';
	import type { ResolvedPathname } from '$app/types';
	import type { RequestOptions } from '$lib/data/options';
	import type { TicketChoice } from '$lib/data/tickets';
	import type { ParentRef, Ticket } from '$lib/domain/ticket';
	import type { TicketDetailStore } from '$lib/stores/ticket-detail.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import TicketCombobox from './TicketCombobox.svelte';

	// Row "Übergeordnet" of the fields (ADR-0033 section 4), shared by the side panel and the full
	// view. A sub-task names its parent with "Ändern" and "Lösen" and the switch "Blockiert das
	// übergeordnete Ticket"; a top-level ticket offers "Festlegen …", unless it has sub-tasks itself
	// (one level only). Choosing happens inline with the ticket search, because no dialog may open
	// from the full view (ADR-0025 section 3); only tickets without a parent of their own are
	// offered, the hook checks the rest. Escape while choosing ends it and is consumed, so neither
	// the panel nor the full view closes. The row consists of two cells of the grid of TicketFields.
	let {
		store,
		ticket,
		parent,
		parentHref = null,
		subtaskCount = 0,
		search
	}: {
		store: TicketDetailStore;
		ticket: Ticket;
		/** The parent as the list knows it, null for a top-level ticket. */
		parent: ParentRef | null;
		/** Address of the parent's panel (or full view). */
		parentHref?: ResolvedPathname | null;
		/** Number of sub-tasks of this ticket. */
		subtaskCount?: number;
		/** Ticket search by number, key or title. */
		search: (text: string, options: RequestOptions) => Promise<TicketChoice[]>;
	} = $props();

	const uid = $props.id();
	const ids = {
		term: `${uid}-term`,
		error: `${uid}-error`,
		switchHint: `${uid}-switch-hint`,
		switchError: `${uid}-switch-error`
	};

	let choosing = $state(false);
	let choice = $state<TicketChoice | null>(null);
	let choiceError = $state<string | null>(null);
	let startButton = $state<HTMLButtonElement>();
	let area = $state<HTMLElement>();

	const saving = $derived(store.isSaving('parent'));
	const error = $derived(store.fieldError('parent'));
	const switchError = $derived(store.fieldError('blocksParent'));
	const blocks = $derived(ticket.blocksParent ?? true);

	/** Only top-level tickets other than this one and its current parent can become the parent. */
	async function allowed(text: string, options: RequestOptions): Promise<TicketChoice[]> {
		const found = await search(text, options);
		return found.filter(
			(entry) => entry.id !== ticket.id && entry.id !== parent?.id && !entry.parentId
		);
	}

	async function start() {
		choosing = true;
		choice = null;
		choiceError = null;
		await tick();
		area?.querySelector<HTMLInputElement>('input[role="combobox"]')?.focus();
	}

	async function end() {
		choosing = false;
		choice = null;
		choiceError = null;
		await tick();
		startButton?.focus();
	}

	async function take() {
		if (saving) return;
		if (choice === null) {
			choiceError = 'Bitte ein Ticket wählen.';
			return;
		}
		choiceError = null;
		if (await store.setParent({ id: choice.id, key: choice.key })) await end();
	}

	async function release() {
		if (saving) return;
		if (await store.setParent(null)) {
			await tick();
			startButton?.focus();
		}
	}

	async function toggleBlocks(event: Event & { currentTarget: HTMLInputElement }) {
		const input = event.currentTarget;
		const wanted = input.checked;
		if (!(await store.setBlocksParent(wanted))) input.checked = !wanted;
	}

	function onkeydown(event: KeyboardEvent) {
		// The combobox consumes Escape for its list and its text first.
		if (event.key !== 'Escape' || event.defaultPrevented) return;
		event.preventDefault();
		event.stopPropagation();
		void end();
	}
</script>

<span class="term" id={ids.term}>Übergeordnet</span>
<div class="control" aria-labelledby={ids.term} role="group">
	{#if choosing}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="choose" bind:this={area} {onkeydown}>
			<TicketCombobox
				label={parent ? 'Neues übergeordnetes Ticket' : 'Übergeordnetes Ticket'}
				hint="Nummer, Key oder Titel eingeben; nur Tickets ohne eigenes übergeordnetes Ticket."
				search={allowed}
				bind:value={choice}
				error={choiceError ?? error}
			/>
			<div class="buttons">
				<button
					class="button-primary small-primary"
					type="button"
					aria-disabled={saving ? 'true' : undefined}
					onclick={take}
				>
					{saving ? 'Wird gespeichert …' : 'Übernehmen'}
				</button>
				<button class="small" type="button" onclick={end}>Abbrechen</button>
			</div>
		</div>
	{:else if parent}
		<div class="parent-line">
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the caller passes a resolved address -->
			<a class="parent-key" href={parentHref ?? undefined}>{parent.key}</a>
			<span class="parent-title" title={parent.title}>{parent.title}</span>
			<button
				class="button-icon"
				type="button"
				aria-label="Übergeordnetes Ticket ändern"
				title="Ändern"
				bind:this={startButton}
				onclick={start}
			>
				<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
					<path d="M10.5 3l2.5 2.5L6 12.5H3.5V10z" />
				</svg>
			</button>
			<button
				class="button-icon"
				type="button"
				aria-label="Aus übergeordnetem Ticket lösen"
				title="Lösen"
				aria-disabled={saving ? 'true' : undefined}
				onclick={release}
			>
				<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
					<path d="M4 4l8 8M12 4l-8 8" />
				</svg>
			</button>
		</div>
		{#if error}
			<p class="field-error" id={ids.error}><ErrorIcon /><span>{error}</span></p>
		{/if}
		<label class="switch-row">
			<span>Blockiert das übergeordnete Ticket</span>
			<input
				type="checkbox"
				role="switch"
				checked={blocks}
				aria-busy={store.isSaving('blocksParent') ? 'true' : undefined}
				aria-invalid={switchError ? 'true' : undefined}
				aria-describedby={switchError ? `${ids.switchHint} ${ids.switchError}` : ids.switchHint}
				onchange={toggleBlocks}
			/>
		</label>
		<p class="hint" id={ids.switchHint}>
			{blocks
				? `Solange diese Unteraufgabe offen ist, fragt das Erledigen von ${parent.key} nach.`
				: `${parent.key} lässt sich erledigen, auch wenn diese Unteraufgabe offen ist.`}
		</p>
		{#if switchError}
			<p class="field-error" id={ids.switchError}><ErrorIcon /><span>{switchError}</span></p>
		{/if}
	{:else if subtaskCount > 0}
		<span class="muted">Keins – hat selbst Unteraufgaben</span>
	{:else}
		<div class="parent-line">
			<span class="muted">Keins</span>
			<button class="small" type="button" bind:this={startButton} onclick={start}>
				Festlegen …
			</button>
		</div>
		{#if error}
			<p class="field-error" id={ids.error}><ErrorIcon /><span>{error}</span></p>
		{/if}
	{/if}
</div>

<style>
	.term {
		color: var(--color-text-muted);
	}

	.control {
		display: grid;
		gap: 0.25rem;
		min-width: 0;
	}

	.choose {
		display: grid;
		gap: 0.5rem;
	}

	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.parent-line {
		display: flex;
		gap: 0.375rem;
		align-items: center;
		min-width: 0;
	}

	.parent-key {
		font-family: var(--font-mono);
		font-size: var(--font-size-control);
		color: var(--color-brand-text);
		white-space: nowrap;
	}

	.parent-title {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.button-icon svg {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	/* Name left, switch right, like "Glas-Effekt" (ADR-0029, G-5). */
	.switch-row {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		justify-content: space-between;
		margin-top: 0.25rem;
		cursor: pointer;
	}

	.hint,
	.muted {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}

	.small {
		padding: 0.125rem 0.625rem;
		font-size: var(--font-size-control);
		background: none;
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
		cursor: pointer;
	}

	.small-primary {
		padding: 0.25rem 0.75rem;
		font-size: var(--font-size-control);
	}
</style>
