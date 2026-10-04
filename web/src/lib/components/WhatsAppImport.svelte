<script lang="ts">
	import { untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { resolve } from '$app/paths';
	import { formatCalendarDate } from '$lib/domain/format';
	import type { InboxDraft } from '$lib/domain/inbox';
	import { matchKeyword } from '$lib/domain/keywords';
	import {
		matchesMessageFilter,
		messageDraft,
		sendersOf,
		type ChatMessage
	} from '$lib/domain/whatsapp-export';
	import { draftsSummary, type DraftsOutcome } from '$lib/stores/capture';
	import ErrorIcon from './ErrorIcon.svelte';
	import EmptyState from './guidance/EmptyState.svelte';
	import SectionMessage from './guidance/SectionMessage.svelte';
	import Modal from './overlay/Modal.svelte';

	// Selection view of a WhatsApp export (E4 plan, package 16) on the modal building block
	// (ADR-0025 section 3, size L): every message with a checkbox, filters by sender and period,
	// "Alle sichtbaren auswählen". Only the chosen messages become entries; messages a keyword of
	// the user matches are chosen at first (package 21, ADR-0020) and keep it in source_meta.
	// Failures stay listed with their reason, and the footer then says "Schließen", because some
	// entries are saved already.
	let {
		chat,
		messages,
		leftOut,
		keywords = [],
		onsave,
		onclose
	}: {
		chat: string;
		messages: readonly ChatMessage[];
		/** System lines, media and deleted messages that are not offered. */
		leftOut: number;
		/** Keywords of the WhatsApp export (users.import_keywords). */
		keywords?: readonly string[];
		onsave: (drafts: InboxDraft[]) => Promise<DraftsOutcome>;
		onclose: (outcome: DraftsOutcome | null) => void;
	} = $props();

	const uid = $props.id();
	const ids = {
		form: `${uid}-form`,
		summary: `${uid}-summary`,
		sender: `${uid}-sender`,
		from: `${uid}-from`,
		to: `${uid}-to`,
		count: `${uid}-count`
	};

	let sender = $state('');
	let from = $state('');
	let to = $state('');
	/** Keyword that matches each message, by index ('' for none). */
	const keywordOf = $derived(
		new Map(messages.map((message) => [message.index, matchKeyword(keywords, [message.text])]))
	);
	const chosen = new SvelteSet<number>(
		untrack(() =>
			messages
				.filter((message) => matchKeyword(keywords, [message.text]) !== '')
				.map((message) => message.index)
		)
	);
	let pending = $state(false);
	let outcome = $state<DraftsOutcome | null>(null);

	const senders = $derived(sendersOf(messages));
	const visible = $derived(
		messages.filter((message) => matchesMessageFilter(message, { sender, from, to }))
	);
	const chosenMessages = $derived(messages.filter((message) => chosen.has(message.index)));
	const periodInvalid = $derived(from !== '' && to !== '' && from > to);

	function chooseVisible() {
		for (const message of visible) chosen.add(message.index);
	}

	function clearChoice() {
		chosen.clear();
	}

	function toggle(index: number, checked: boolean) {
		if (checked) chosen.add(index);
		else chosen.delete(index);
	}

	function countText(count: number): string {
		return count === 1 ? '1 Nachricht' : `${count} Nachrichten`;
	}

	async function save(event: Event) {
		event.preventDefault();
		if (pending || chosenMessages.length === 0) return;
		pending = true;
		const result = await onsave(
			chosenMessages.map((message) => {
				const draft = messageDraft(message, chat);
				const keyword = keywordOf.get(message.index) ?? '';
				return keyword === ''
					? draft
					: { ...draft, sourceMeta: { ...(draft.sourceMeta ?? {}), keyword } };
			})
		);
		pending = false;
		if (result.failures.length === 0) {
			onclose(result);
			return;
		}
		outcome = result;
	}
</script>

<Modal
	open
	size="l"
	title={`WhatsApp-Chat „${chat}“`}
	describedBy={ids.summary}
	busy={pending}
	onclose={() => onclose(outcome)}
>
	<p id={ids.summary} class="hint">
		{countText(messages.length)} zur Auswahl{#if leftOut > 0}, {leftOut} ausgelassen (Systemzeilen, Medien,
			gelöschte Nachrichten){/if}. Nur die ausgewählten Nachrichten kommen in den Eingang.
		{#if keywords.length > 0}
			Nachrichten mit einem deiner Stichwörter sind vorausgewählt.
		{/if}
	</p>
	{#if keywords.length === 0}
		<SectionMessage tone="info">
			Für den WhatsApp-Export sind keine Stichwörter festgelegt, deshalb ist nichts vorausgewählt.
			{#snippet actions()}
				<a href={resolve('/einstellungen/datei-importe')}
					>Stichwörter unter „Datei-Importe“ festlegen</a
				>
			{/snippet}
		</SectionMessage>
	{/if}
	<form id={ids.form} class="form" novalidate onsubmit={save}>
		<div class="filters">
			<div class="field">
				<label for={ids.sender}>Absender</label>
				<select id={ids.sender} title={sender || undefined} bind:value={sender}>
					<option value="">Alle</option>
					{#each senders as name (name)}
						<option value={name}>{name}</option>
					{/each}
				</select>
			</div>
			<div class="field">
				<label for={ids.from}>Von</label>
				<input id={ids.from} type="date" bind:value={from} />
			</div>
			<div class="field">
				<label for={ids.to}>Bis</label>
				<input
					id={ids.to}
					type="date"
					bind:value={to}
					aria-invalid={periodInvalid ? 'true' : undefined}
					aria-describedby={periodInvalid ? `${ids.to}-error` : undefined}
				/>
			</div>
		</div>
		{#if periodInvalid}
			<p id={`${ids.to}-error`} class="field-error">
				<ErrorIcon /><span>„Bis“ liegt vor „Von“.</span>
			</p>
		{/if}

		<div class="choice">
			<button class="button-secondary" type="button" onclick={chooseVisible}>
				Alle sichtbaren auswählen
			</button>
			<button class="button-secondary" type="button" onclick={clearChoice}>
				Auswahl aufheben
			</button>
			<span id={ids.count} class="hint" aria-live="polite">
				{countText(visible.length)} sichtbar, {chosen.size} ausgewählt
			</span>
		</div>

		<fieldset class="messages">
			<legend class="visually-hidden">Nachrichten</legend>
			{#if visible.length === 0}
				<div class="none">
					<EmptyState
						size="compact"
						title="Keine Nachricht passt zu den Filtern"
						headingLevel={3}
					/>
				</div>
			{:else}
				<ul>
					{#each visible as message (message.index)}
						<li>
							<label>
								<input
									type="checkbox"
									checked={chosen.has(message.index)}
									onchange={(event) => toggle(message.index, event.currentTarget.checked)}
								/>
								<span class="meta">
									{formatCalendarDate(message.date)}
									{message.time} · {message.sender}
								</span>
								<span class="text">{message.text}</span>
								{#if (keywordOf.get(message.index) ?? '') !== ''}
									<span class="meta">Stichwort: {keywordOf.get(message.index)}</span>
								{/if}
							</label>
						</li>
					{/each}
				</ul>
			{/if}
		</fieldset>

		{#if outcome !== null}
			<div class="alert-error" role="alert">
				<ErrorIcon />
				<div>
					<p>{draftsSummary(outcome)}</p>
					<ul>
						{#each outcome.failures as failure, index (index)}
							<li>„{failure.title}“: {failure.message}</li>
						{/each}
					</ul>
				</div>
			</div>
		{/if}
	</form>

	{#snippet footer({ close })}
		<button class="button-secondary" type="button" onclick={close}>
			{outcome === null ? 'Abbrechen' : 'Schließen'}
		</button>
		<button
			class="button-primary"
			type="submit"
			form={ids.form}
			aria-disabled={pending || chosenMessages.length === 0 ? 'true' : undefined}
		>
			{pending ? 'Wird übernommen …' : `${countText(chosenMessages.length)} in den Eingang`}
		</button>
	{/snippet}
</Modal>

<style>
	.form {
		display: grid;
		gap: 0.625rem;
	}

	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	.field {
		display: grid;
		gap: 0.25rem;
	}

	label {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text-muted);
	}

	.choice {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}

	/* The content of the modal scrolls; the list has no scroll area of its own. */
	.messages {
		margin: 0;
		padding: 0;
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
	}

	.messages ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.messages li + li {
		border-top: 1px solid var(--color-line);
	}

	.messages label {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 0.125rem 0.5rem;
		padding: 0.5rem 0.75rem;
		font-weight: 400;
		color: var(--color-text);
		cursor: pointer;
	}

	.messages input {
		grid-row: span 3;
		margin-top: 0.125rem;
	}

	.meta {
		grid-column: 2;
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.text {
		font-size: 0.875rem;
		white-space: pre-line;
		overflow-wrap: anywhere;
	}

	.messages .none {
		padding: 0.75rem;
	}

	.hint {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}
</style>
