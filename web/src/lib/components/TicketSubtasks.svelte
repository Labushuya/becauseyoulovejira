<script lang="ts">
	import { tick } from 'svelte';
	import type { ResolvedPathname } from '$app/types';
	import { progressLabel, progressPercent, progressText } from '$lib/domain/subtasks';
	import { TITLE_MAX_LENGTH, type TicketSummary } from '$lib/domain/ticket';
	import type { TicketListStore } from '$lib/stores/ticket-list.svelte';
	import DoneToggle from './DoneToggle.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import StatusPill from './StatusPill.svelte';

	// Section "Unteraufgaben" (ADR-0033 section 4), shared by the side panel and the full view: the
	// sub-tasks of a top-level ticket with check mark, key, title (link to their panel) and status,
	// open ones first, then by creation; the progress as text and as a quiet bar. "Unteraufgabe
	// hinzufügen" opens a field in the section: Enter creates one (project and tags of the ticket)
	// and keeps the field for the next, Escape closes it and is consumed, so neither the panel nor
	// the full view closes. Everything comes from the list store and follows realtime.
	let {
		ticket,
		list,
		hrefOf
	}: {
		ticket: TicketSummary;
		list: Pick<
			TicketListStore,
			'subtasksOf' | 'progressOf' | 'isChecked' | 'isPending' | 'setDone' | 'addSubtask'
		>;
		/** Address of the panel of a sub-task, with the list query of the current page. */
		hrefOf: (id: string) => ResolvedPathname;
	} = $props();

	const uid = $props.id();
	const ids = {
		title: `${uid}-title`,
		progress: `${uid}-progress`,
		input: `${uid}-input`,
		hint: `${uid}-hint`,
		error: `${uid}-error`
	};

	const subtasks = $derived(list.subtasksOf(ticket.id));
	const progress = $derived(list.progressOf(ticket.id));

	let adding = $state(false);
	let text = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);
	/** Polite message after creating one, e.g. "TASK-16 angelegt." */
	let status = $state('');
	let input = $state<HTMLInputElement>();
	let addButton = $state<HTMLButtonElement>();

	async function open() {
		adding = true;
		error = null;
		status = '';
		await tick();
		input?.focus();
	}

	async function close() {
		adding = false;
		text = '';
		error = null;
		await tick();
		addButton?.focus();
	}

	async function add(event: SubmitEvent) {
		event.preventDefault();
		if (busy || text.trim() === '') return;
		busy = true;
		error = null;
		const title = text;
		const result = await list.addSubtask(ticket, title);
		busy = false;
		if (result.ok) {
			// What was typed meanwhile stays; only the saved title leaves the field.
			if (text === title) text = '';
			status = `${result.ticket.key} angelegt.`;
			input?.focus();
		} else if (result.message !== null) {
			error = result.message;
		}
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		event.stopPropagation();
		void close();
	}
</script>

<section class="subtasks" aria-labelledby={ids.title} data-ticket-option="subtasks">
	<div class="section-head">
		<h3 id={ids.title}>Unteraufgaben</h3>
		{#if progress.total > 0}
			<span class="progress-text" id={ids.progress}>
				<span aria-hidden="true">{progressText(progress)}</span>
				<span class="visually-hidden">{progressLabel(progress)}</span>
			</span>
		{/if}
	</div>
	{#if progress.total > 0}
		<div class="bar" aria-hidden="true">
			<span class="bar-fill" style:width={`${progressPercent(progress)}%`}></span>
		</div>
		<ul class="list" aria-labelledby={ids.title}>
			{#each subtasks as child (child.id)}
				<li class="item" class:done={child.status === 'done'}>
					<DoneToggle
						key={child.key}
						checked={list.isChecked(child)}
						pending={list.isPending(child.id)}
						onchange={(done) => list.setDone(child.id, done)}
					/>
					<span class="key">{child.key}</span>
					<a class="child-title" href={hrefOf(child.id)}>{child.title}</a>
					<StatusPill status={child.status} />
				</li>
			{/each}
		</ul>
	{:else if !adding}
		<p class="muted">Keine Unteraufgaben.</p>
	{/if}

	{#if adding}
		<form class="add" novalidate onsubmit={add}>
			<label class="visually-hidden" for={ids.input}>Titel der Unteraufgabe</label>
			<input
				id={ids.input}
				type="text"
				maxlength={TITLE_MAX_LENGTH}
				placeholder="Titel der Unteraufgabe"
				autocomplete="off"
				bind:value={text}
				bind:this={input}
				aria-busy={busy ? 'true' : undefined}
				aria-invalid={error ? 'true' : undefined}
				aria-describedby={error ? `${ids.hint} ${ids.error}` : ids.hint}
				{onkeydown}
			/>
			<p class="hint" id={ids.hint}>Enter legt sie an, Esc schließt das Feld.</p>
			{#if error}
				<p class="field-error" id={ids.error}><ErrorIcon /><span>{error}</span></p>
			{/if}
		</form>
	{:else}
		<button
			class="button-secondary button-small"
			type="button"
			bind:this={addButton}
			onclick={open}
		>
			Unteraufgabe hinzufügen
		</button>
	{/if}
	<p class="visually-hidden" aria-live="polite">{status}</p>
</section>

<style>
	.subtasks {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.5rem;
		justify-items: start;
	}

	.section-head {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: baseline;
		justify-content: space-between;
		justify-self: stretch;
	}

	h3 {
		font-size: var(--font-size-body);
		font-weight: 600;
	}

	.progress-text {
		font-size: var(--font-size-small);
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
	}

	/* Quiet bar: the line colour as track, the accent for the done share. */
	.bar {
		justify-self: stretch;
		height: 0.25rem;
		overflow: hidden;
		background: var(--color-line);
		border-radius: var(--radius-pill);
	}

	.bar-fill {
		display: block;
		height: 100%;
		background: var(--color-brand);
		border-radius: var(--radius-pill);
	}

	.list {
		display: grid;
		justify-self: stretch;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.item {
		display: grid;
		grid-template-columns: auto auto minmax(0, 1fr) auto;
		gap: 0.5rem;
		align-items: center;
		padding: 0.3125rem 0;
		font-size: var(--font-size-body);
		border-bottom: 1px solid var(--color-line);
	}

	.key {
		font-family: var(--font-mono);
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	.child-title {
		overflow: hidden;
		color: inherit;
		text-decoration: none;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.child-title:hover {
		text-decoration: underline;
	}

	/* Done sub-tasks step back (CLAUDE.md section 8). */
	.done .child-title {
		color: var(--color-text-muted);
	}

	.add {
		display: grid;
		gap: 0.25rem;
		justify-self: stretch;
	}

	.add input {
		width: 100%;
	}

	.hint,
	.muted {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}
</style>
