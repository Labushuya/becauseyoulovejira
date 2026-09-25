<script lang="ts">
	import { tick, untrack } from 'svelte';
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

	// Mailbox selection (E4 plan, package 23; ADR-0016 section 6, ADR-0020 section 4) as a native modal
	// <dialog> after the model of the file import: the last mails of the inbox of a mail connection
	// with a checkbox each. Mails with a keyword in the subject are chosen at first, mails that are
	// in the inbox already are shown but cannot be chosen. Only the chosen mails are taken, also
	// without keyword and also from before the setup. The dialog stays open after taking them and
	// shows the result per mail; a failed mail can be chosen again. The mailbox itself stays as it is.
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
		heading: `${uid}-heading`,
		summary: `${uid}-summary`,
		limit: `${uid}-limit`
	};

	type View =
		| { kind: 'loading' }
		| { kind: 'ready'; mails: MailboxMail[] }
		| { kind: 'unavailable' | 'failed'; message: string; hint: string };

	let dialog = $state<HTMLDialogElement>();
	let limitSelect = $state<HTMLSelectElement>();
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

	$effect(() => {
		const element = dialog;
		if (element === undefined) return;
		const previous = document.activeElement;
		if (!element.open) element.showModal();
		void tick().then(() => limitSelect?.focus());
		return () => {
			controller?.abort();
			if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
		};
	});

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

	function close() {
		if (!pending) onclose();
	}
</script>

<dialog
	class="mailbox"
	bind:this={dialog}
	aria-labelledby={ids.heading}
	aria-describedby={ids.summary}
	oncancel={(event) => {
		event.preventDefault();
		close();
	}}
>
	<h2 id={ids.heading}>Aus dem Postfach wählen</h2>
	<p id={ids.summary} class="hint">
		„{label}“: die letzten Mails des Posteingangs. Nur die ausgewählten kommen in den Eingang, auch
		ohne Stichwort und auch aus der Zeit vor der Einrichtung. Das Postfach bleibt unverändert.
		{#if preselected > 0}
			Mails mit einem Stichwort im Betreff sind vorausgewählt.
		{/if}
	</p>
	<div class="visually-hidden" aria-live="polite">{announcement}</div>

	<div class="field">
		<label for={ids.limit}>Anzahl</label>
		<select
			id={ids.limit}
			bind:this={limitSelect}
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
	{:else if view.kind === 'unavailable'}
		<div class="notice" role="status">
			<p>{view.message}</p>
			{#if view.hint !== ''}<p>{view.hint}</p>{/if}
		</div>
		<p>
			<button class="secondary" type="button" onclick={() => void refresh(limit)}
				>Erneut versuchen</button
			>
		</p>
	{:else if view.kind === 'failed'}
		<div class="alert-error" role="alert"><ErrorIcon /><span>{view.message}</span></div>
		{#if view.hint !== ''}<p class="notice">{view.hint}</p>{/if}
		<p>
			<button class="secondary" type="button" onclick={() => void refresh(limit)}
				>Erneut versuchen</button
			>
		</p>
	{/if}

	<form class="form" novalidate onsubmit={submit}>
		{#if view.kind === 'ready'}
			{#if mails.length === 0}
				<p class="hint">Der Posteingang ist leer.</p>
			{:else}
				<div class="choice">
					<button
						class="secondary"
						type="button"
						onclick={() => {
							for (const mail of open) chosen.add(mail.uid);
						}}
					>
						Alle auswählen
					</button>
					<button class="secondary" type="button" onclick={() => chosen.clear()}>
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
			<div class="alert-error" role="alert"><ErrorIcon /><span>{saveError.message}</span></div>
			{#if saveError.hint !== ''}<p class="notice">{saveError.hint}</p>{/if}
		{/if}

		<div class="buttons">
			<button class="secondary" type="button" onclick={close}>Schließen</button>
			{#if view.kind === 'ready' && mails.length > 0}
				<button
					class="button-primary"
					type="submit"
					aria-disabled={pending || chosenCount === 0 ? 'true' : undefined}
				>
					{pending ? 'Wird übernommen …' : `${countText(chosenCount)} in den Eingang`}
				</button>
			{/if}
		</div>
	</form>
</dialog>

<style>
	.mailbox {
		width: min(44rem, calc(100vw - 2rem));
		max-height: calc(100vh - 2rem);
		margin: auto;
		padding: 1.25rem;
		color: var(--color-text);
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: 0.5rem;
	}

	.mailbox::backdrop {
		background: var(--color-bg);
		opacity: 0.75;
	}

	h2 {
		margin-bottom: 0.5rem;
		font-size: 1rem;
		font-weight: 600;
	}

	.field {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		margin: 0.75rem 0;
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
		border-radius: 0.375rem;
	}

	.form {
		display: grid;
		gap: 0.625rem;
		margin-top: 0.75rem;
	}

	.choice {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}

	.entries {
		max-height: 22rem;
		overflow-y: auto;
		margin: 0;
		padding: 0;
		border: 1px solid var(--color-line);
		border-radius: 0.375rem;
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

	.notice {
		display: grid;
		gap: 0.25rem;
		padding: 0.375rem 0.625rem;
		font-size: 0.8125rem;
		color: var(--color-brand-soft-text);
		background: var(--color-brand-soft-bg);
		border-radius: 0.375rem;
	}

	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		justify-content: flex-end;
	}

	.secondary {
		padding: 0.5rem 0.875rem;
		background: none;
		border: 1px solid var(--color-line);
		border-radius: 0.375rem;
		cursor: pointer;
	}

	.button-primary[aria-disabled='true'] {
		cursor: not-allowed;
		opacity: 0.6;
	}
</style>
