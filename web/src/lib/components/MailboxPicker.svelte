<script lang="ts">
	import { untrack } from 'svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { formatBerlinDateTime } from '$lib/domain/format';
	import {
		MAILBOX_DEFAULT_LIMIT,
		MAILBOX_LIMITS,
		importSummary,
		preselectedUids,
		sizeText,
		type MailboxImportResult,
		type MailboxLimit,
		type MailboxMail,
		type MailboxOutcome
	} from '$lib/domain/mailbox';
	import ErrorIcon from './ErrorIcon.svelte';
	import EmptyState from './guidance/EmptyState.svelte';
	import SectionMessage from './guidance/SectionMessage.svelte';
	import Modal from './overlay/Modal.svelte';

	// Mailbox selection (E4 plan, package 23; ADR-0016 section 6, ADR-0020 section 4) on the modal
	// building block (ADR-0025 section 3, size L), after the model of the file import: the last
	// mails of the inbox of a mail connection with a checkbox each. Mails with a keyword in the
	// subject are chosen at first, mails that are in the inbox already are shown but cannot be
	// chosen. Only the chosen mails are taken, also without keyword and also from before the setup.
	// The dialog stays open after taking them and shows the result per mail; a failed mail can be
	// chosen again, and the footer says "Schließen" from then on. The mailbox stays as it is.
	let {
		label,
		load,
		save,
		onclose
	}: {
		/** Label of the connection. */
		label: string;
		/** null: the session ended or the request was aborted. */
		load: (limit: number, signal: AbortSignal) => Promise<MailboxOutcome<MailboxMail[]> | null>;
		save: (uids: readonly number[]) => Promise<MailboxOutcome<MailboxImportResult[]> | null>;
		onclose: () => void;
	} = $props();

	const uid = $props.id();
	const ids = {
		form: `${uid}-form`,
		summary: `${uid}-summary`,
		limit: `${uid}-limit`
	};

	type View =
		| { kind: 'loading' }
		| { kind: 'ready'; mails: MailboxMail[] }
		| { kind: 'unavailable' | 'failed'; message: string; hint: string };

	let limit = $state<MailboxLimit>(MAILBOX_DEFAULT_LIMIT);
	let view = $state<View>({ kind: 'loading' });
	let pending = $state(false);
	let saveError = $state<{ message: string; hint: string } | null>(null);
	let announcement = $state('');
	const chosen = new SvelteSet<number>();
	const results = new SvelteMap<number, MailboxImportResult>();
	let controller: AbortController | null = null;

	const mails = $derived(view.kind === 'ready' ? view.mails : []);
	const open = $derived(mails.filter((mail) => blockedReason(mail) === ''));
	const chosenCount = $derived(open.filter((mail) => chosen.has(mail.uid)).length);
	const preselected = $derived(preselectedUids(mails).length);

	// A request still running when the dialog goes away is aborted.
	$effect(() => () => controller?.abort());

	// Loads the list at the start and whenever the number changes.
	$effect(() => {
		const count = limit;
		untrack(() => void refresh(count));
	});

	async function refresh(count: number) {
		controller?.abort();
		const current = new AbortController();
		controller = current;
		view = { kind: 'loading' };
		saveError = null;
		results.clear();
		chosen.clear();
		const outcome = await load(count, current.signal);
		if (controller !== current) return;
		controller = null;
		if (outcome === null) return;
		if (outcome.kind !== 'ok') {
			view = { kind: outcome.kind, message: outcome.message, hint: outcome.hint };
			return;
		}
		view = { kind: 'ready', mails: outcome.value };
		for (const mailUid of preselectedUids(outcome.value)) chosen.add(mailUid);
	}

	/** Why a mail cannot be chosen: already in the inbox (also after this import), else ''. */
	function blockedReason(mail: MailboxMail): string {
		const result = results.get(mail.uid);
		if (result?.status === 'created') return 'Jetzt im Eingang.';
		if (result?.status === 'duplicate') return result.message || 'Schon im Eingang.';
		return mail.state === '' ? '' : mail.stateMessage || 'Schon im Eingang.';
	}

	function countText(count: number): string {
		return count === 1 ? '1 Mail' : `${count} Mails`;
	}

	function metaLine(mail: MailboxMail): string {
		return [
			mail.date === null ? '' : formatBerlinDateTime(mail.date),
			mail.from,
			sizeText(mail.size)
		]
			.filter((part) => part !== '')
			.join(' · ');
	}

	function toggle(mailUid: number, checked: boolean) {
		if (checked) chosen.add(mailUid);
		else chosen.delete(mailUid);
	}

	async function submit(event: Event) {
		event.preventDefault();
		if (pending || chosenCount === 0) return;
		pending = true;
		saveError = null;
		const uids = open.filter((mail) => chosen.has(mail.uid)).map((mail) => mail.uid);
		const outcome = await save(uids);
		pending = false;
		if (outcome === null) return;
		if (outcome.kind !== 'ok') {
			saveError = { message: outcome.message, hint: outcome.hint };
			return;
		}
		for (const result of outcome.value) {
			results.set(result.uid, result);
			if (result.status !== 'failed') chosen.delete(result.uid);
		}
		announcement = importSummary(outcome.value);
	}
</script>

<Modal
	open
	size="l"
	title="Aus dem Postfach wählen"
	describedBy={ids.summary}
	busy={pending}
	onclose={() => onclose()}
>
	<p id={ids.summary} class="hint">
		„{label}“: die letzten Mails des Posteingangs. Nur die ausgewählten kommen in den Eingang, auch
		ohne Stichwort und auch aus der Zeit vor der Einrichtung. Das Postfach bleibt unverändert.
		{#if preselected > 0}
			Mails mit einem Stichwort in Betreff oder Absender sind vorausgewählt.
		{/if}
	</p>
	<div class="visually-hidden" aria-live="polite">{announcement}</div>

	<div class="field">
		<label for={ids.limit}>Anzahl</label>
		<select
			id={ids.limit}
			value={limit}
			disabled={pending}
			onchange={(event) => (limit = Number(event.currentTarget.value) as MailboxLimit)}
		>
			{#each MAILBOX_LIMITS as value (value)}
				<option {value}>Letzte {value}</option>
			{/each}
		</select>
	</div>

	{#if view.kind === 'loading'}
		<p class="hint" role="status">Das Postfach wird gelesen …</p>
	{:else if view.kind === 'unavailable' || view.kind === 'failed'}
		<!-- A stopped helper is neutral (info), a refused login or a broken mailbox an error. -->
		<SectionMessage tone={view.kind === 'failed' ? 'error' : 'info'} live>
			<p>{view.message}</p>
			{#if view.hint !== ''}<p>{view.hint}</p>{/if}
			{#snippet actions()}
				<button class="button-subtle" type="button" onclick={() => void refresh(limit)}
					>Erneut versuchen</button
				>
			{/snippet}
		</SectionMessage>
	{/if}

	<form id={ids.form} class="form" novalidate onsubmit={submit}>
		{#if view.kind === 'ready'}
			{#if mails.length === 0}
				<EmptyState size="compact" title="Der Posteingang ist leer" headingLevel={3} />
			{:else}
				<div class="choice">
					<button
						class="button-secondary"
						type="button"
						onclick={() => {
							for (const mail of open) chosen.add(mail.uid);
						}}
					>
						Alle auswählen
					</button>
					<button class="button-secondary" type="button" onclick={() => chosen.clear()}>
						Auswahl aufheben
					</button>
					<span class="hint" aria-live="polite">{chosenCount} ausgewählt</span>
				</div>
				<fieldset class="entries">
					<legend class="visually-hidden">Mails des Posteingangs</legend>
					<ul>
						{#each mails as mail (mail.uid)}
							{@const blocked = blockedReason(mail)}
							{@const result = results.get(mail.uid)}
							<li class:blocked={blocked !== ''}>
								<label>
									<input
										type="checkbox"
										checked={blocked === '' && chosen.has(mail.uid)}
										disabled={blocked !== '' || pending}
										onchange={(event) => toggle(mail.uid, event.currentTarget.checked)}
									/>
									<span class="title">{mail.subject}</span>
									<span class="meta">{metaLine(mail)}</span>
									{#if blocked !== ''}
										<span class="meta">{blocked}</span>
									{:else if result?.status === 'failed'}
										<span class="meta failed"><ErrorIcon /><span>{result.message}</span></span>
									{:else if mail.keyword !== ''}
										<span class="meta">Stichwort: {mail.keyword}</span>
									{/if}
								</label>
							</li>
						{/each}
					</ul>
				</fieldset>
			{/if}
		{/if}

		{#if saveError !== null}
			<SectionMessage tone="error" live>
				<p>{saveError.message}</p>
				{#if saveError.hint !== ''}<p>{saveError.hint}</p>{/if}
			</SectionMessage>
		{/if}
	</form>

	{#snippet footer({ close })}
		<button class="button-secondary" type="button" onclick={close}>
			{results.size === 0 ? 'Abbrechen' : 'Schließen'}
		</button>
		{#if view.kind === 'ready' && mails.length > 0}
			<button
				class="button-primary"
				type="submit"
				form={ids.form}
				aria-disabled={pending || chosenCount === 0 ? 'true' : undefined}
			>
				{pending ? 'Wird übernommen …' : `${countText(chosenCount)} in den Eingang`}
			</button>
		{/if}
	{/snippet}
</Modal>

<style>
	.field {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}

	label[for] {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text-muted);
	}

	select {
		padding: 0.375rem 0.5rem;
		font: inherit;
		color: var(--color-text);
		background: var(--color-surface);
		border: 1px solid var(--color-text-muted);
		border-radius: var(--radius-control);
	}

	.form {
		display: grid;
		gap: 0.625rem;
	}

	.choice {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}

	/* The content of the modal scrolls; the list has no scroll area of its own. */
	.entries {
		margin: 0;
		padding: 0;
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
	}

	.entries ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.entries li + li {
		border-top: 1px solid var(--color-line);
	}

	.entries label {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 0.125rem 0.5rem;
		padding: 0.5rem 0.75rem;
		cursor: pointer;
	}

	.entries input {
		grid-row: span 3;
		margin-top: 0.125rem;
	}

	.blocked label {
		cursor: default;
	}

	.blocked .title {
		color: var(--color-text-muted);
	}

	.title {
		font-size: 0.875rem;
		overflow-wrap: anywhere;
	}

	.meta {
		grid-column: 2;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		overflow-wrap: anywhere;
	}

	.meta.failed {
		display: inline-flex;
		gap: 0.25rem;
		align-items: center;
		color: var(--color-danger);
	}

	.hint {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}
</style>
