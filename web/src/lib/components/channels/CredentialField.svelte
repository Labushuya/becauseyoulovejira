<script lang="ts">
	import { tick } from 'svelte';
	import { contextNote } from '$lib/domain/context';
	import {
		CREDENTIAL_MESSAGES,
		CREDENTIAL_TEXTS,
		PC_ONLY,
		credentialValueProblem,
		hasOuterSpace,
		pcOnlyNote
	} from '$lib/domain/credentials';
	import type { ProblemEntry } from '$lib/domain/problems';
	import { contextNoteText } from '$lib/guidance/texts';
	import { appContext } from '$lib/stores/context.svelte';
	import type { CredentialOutcome, CredentialsStore } from '$lib/stores/credentials.svelte';
	import type { RestartStore } from '$lib/stores/restart.svelte';
	import SectionMessage from '../guidance/SectionMessage.svelte';
	import ConfirmDialog from '../overlay/ConfirmDialog.svelte';
	import RestartAction from '../system/RestartAction.svelte';

	// One field of a channel that names a Windows variable (BW-3, ADR-0075 V1): the name, its state
	// in the user environment of the PC ("gesetzt" or "fehlt"), "Setzen …" or "Ersetzen …" and
	// "Entfernen …". Only the administrator on the PC under Windows may act (`capabilities.scripts`,
	// the pattern of RestartAction); elsewhere the buttons stay disabled and "Nur am PC möglich"
	// stands, also instead of a state that cannot be read there (V5). The value lives only in the
	// local state of this component while it is typed: a password field with
	// autocomplete="new-password", never filled in, emptied on every submit (success or failure),
	// never in a store, web storage, the address or the outbox (S6, S7). Leading or trailing spaces
	// stay and get a warning (S8). "Entfernen …" asks first and names every channel of the instance
	// that uses the variable (V2). After a change the question "Jetzt neu starten" / "Später" follows
	// (V3; inside a modal inline, ADR-0025 addendum 16): "Jetzt neu starten" runs the restart of the
	// page System through the RestartStore and shows it here; "Später" leaves the hint of the
	// server, which stands until the next restart.
	let {
		name,
		label,
		store,
		restart = null,
		place,
		hint,
		onrestart,
		onrestarted
	}: {
		/** The variable, e.g. BYL_TELEGRAM_TOKEN. */
		name: string;
		/** What it holds, e.g. "Bot-Token". */
		label: string;
		store: CredentialsStore;
		/** "Jetzt neu starten" after a change; without it only the hint stays. */
		restart?: RestartStore | null;
		/** Where a restart of this field runs (RestartStore), unique on the page. */
		place: string;
		/** A note below the actions, e.g. what to set for now. */
		hint?: string;
		/** A restart from here begins (after "Jetzt neu starten"). */
		onrestart?: () => void;
		/** The server is back after a restart from here. */
		onrestarted?: () => void;
	} = $props();

	const uid = $props.id();
	const ids = {
		name: `${uid}-name`,
		note: `${uid}-note`,
		form: `${uid}-form`,
		field: `${uid}-field`,
		help: `${uid}-help`,
		space: `${uid}-space`,
		error: `${uid}-error`
	};

	const capabilities = $derived(appContext.capabilities);
	/** Why the actions are not possible in this tab; null where they are. */
	const note = $derived(contextNote(capabilities, 'script'));
	const noteText = $derived(
		note === null ? '' : note === 'pc-only' ? PC_ONLY : contextNoteText(note, capabilities.localUrl)
	);
	const variable = $derived(store.variable(name));
	const busy = $derived(store.busy === name);
	const anyBusy = $derived(store.busy !== null);
	const blocked = $derived(variable?.blocked === true);
	const allowed = $derived(note === null && !blocked);
	const isSet = $derived(variable?.set === true);

	const stateText = $derived.by(() => {
		if (note !== null) return noteText;
		if (variable === null) {
			return store.state === 'failed' ? CREDENTIAL_TEXTS.unknown : CREDENTIAL_TEXTS.loading;
		}
		if (variable.blocked) return CREDENTIAL_TEXTS.blocked;
		if (variable.set === null) return CREDENTIAL_TEXTS.unknown;
		return variable.set ? CREDENTIAL_TEXTS.set : CREDENTIAL_TEXTS.missing;
	});

	let editing = $state(false);
	/** The typed value: only here, only until the next submit. */
	let draft = $state('');
	let fieldError = $state<string | null>(null);
	let input = $state<HTMLInputElement>();
	let opener = $state<HTMLButtonElement>();

	let removing = $state(false);
	let removeError = $state<string | null>(null);
	let removeProblem = $state.raw<ProblemEntry | null>(null);

	let done = $state<string | null>(null);
	let failure = $state.raw<{
		message: string;
		problem: ProblemEntry | null;
		tone: 'warning' | 'error';
	} | null>(null);
	let asking = $state(false);

	const restartHere = $derived(
		restart !== null && (restart.runningAt(place) || restart.resultAt(place) !== null)
	);
	const describedBy = $derived(
		[ids.help, hasOuterSpace(draft) ? ids.space : null, fieldError !== null ? ids.error : null]
			.filter((id): id is string => id !== null)
			.join(' ')
	);

	async function openForm() {
		if (!allowed || anyBusy) return;
		done = null;
		failure = null;
		fieldError = null;
		draft = '';
		editing = true;
		await tick();
		input?.focus();
	}

	async function closeForm() {
		draft = '';
		fieldError = null;
		editing = false;
		await tick();
		opener?.focus();
	}

	/**
	 * After "Setzen" or "Entfernen": the result here, the focus back on the action of the field, then
	 * the question about the restart (which gives the focus back there when it closes).
	 */
	async function finish(outcome: CredentialOutcome, text: string) {
		if (outcome.kind === 'failed') {
			failure = { message: outcome.message, problem: outcome.problem, tone: outcome.tone };
			return;
		}
		if (outcome.kind !== 'done') return;
		editing = false;
		done = text;
		await tick();
		opener?.focus();
		if (restart !== null) asking = true;
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!allowed || anyBusy) return;
		// The value leaves the field at once, whatever follows (S7).
		const value = draft;
		draft = '';
		fieldError = null;
		failure = null;
		const problem = credentialValueProblem(value);
		if (problem !== null) {
			fieldError = CREDENTIAL_MESSAGES[problem];
			return;
		}
		const outcome = await store.set(name, value);
		if (outcome === null) return;
		if (outcome.kind === 'field') {
			fieldError = outcome.message;
			return;
		}
		await finish(outcome, CREDENTIAL_TEXTS.setDone(name));
	}

	function askRemove() {
		if (!allowed || anyBusy || !isSet) return;
		done = null;
		failure = null;
		removeError = null;
		removeProblem = null;
		removing = true;
	}

	async function confirmRemove() {
		removeError = null;
		const outcome = await store.remove(name);
		if (outcome === null) return;
		if (outcome.kind === 'field') {
			removeError = outcome.message;
			return;
		}
		if (outcome.kind === 'failed') {
			removeError = outcome.message;
			removeProblem = outcome.problem;
			return;
		}
		removing = false;
		await finish(outcome, CREDENTIAL_TEXTS.removeDone(name));
	}

	async function restartNow() {
		asking = false;
		if (restart === null) return;
		onrestart?.();
		const result = await restart.restart(place);
		if (result?.kind === 'restarted') {
			await Promise.all([store.refreshNotice(), store.load()]);
			onrestarted?.();
		}
	}
</script>

<div class="credential" role="group" aria-labelledby={ids.name}>
	<div class="head">
		<code id={ids.name}>{name}</code>
		<span class="state">
			<span class="visually-hidden">{label}:</span>
			{stateText}
		</span>
	</div>
	<p class="label">{label}</p>

	{#if !blocked}
		<div class="actions">
			<button
				class="button-secondary"
				type="button"
				bind:this={opener}
				aria-disabled={!allowed || anyBusy ? 'true' : undefined}
				aria-expanded={allowed ? editing : undefined}
				aria-controls={allowed && editing ? ids.form : undefined}
				aria-describedby={note !== null ? ids.note : undefined}
				onclick={() => void openForm()}
			>
				{isSet ? CREDENTIAL_TEXTS.replaceAction : CREDENTIAL_TEXTS.setAction}
			</button>
			{#if isSet || note !== null}
				<button
					class="button-subtle"
					type="button"
					aria-haspopup="dialog"
					aria-disabled={!allowed || anyBusy ? 'true' : undefined}
					aria-describedby={note !== null ? ids.note : undefined}
					onclick={askRemove}
				>
					{CREDENTIAL_TEXTS.removeAction}
				</button>
			{/if}
		</div>
		{#if note !== null && noteText !== ''}
			<p class="note" id={ids.note}>
				{note === 'pc-only' ? pcOnlyNote(capabilities.localUrl) : noteText}
			</p>
		{/if}
	{/if}
	{#if hint !== undefined && allowed}
		<p class="hint">{hint}</p>
	{/if}

	{#if editing && allowed}
		<form class="form" id={ids.form} novalidate onsubmit={(event) => void submit(event)}>
			<label for={ids.field}>{CREDENTIAL_TEXTS.valueLabel(name)}</label>
			<input
				id={ids.field}
				class="input-mono"
				name={`${uid}-value`}
				type="password"
				autocomplete="new-password"
				spellcheck="false"
				autocapitalize="off"
				data-1p-ignore
				data-lpignore="true"
				data-form-type="other"
				aria-invalid={fieldError !== null ? 'true' : undefined}
				aria-describedby={describedBy}
				bind:this={input}
				bind:value={draft}
			/>
			<p class="hint" id={ids.help}>{CREDENTIAL_TEXTS.valueHint}</p>
			{#if hasOuterSpace(draft)}
				<div id={ids.space}>
					<SectionMessage tone="warning" compact live>{CREDENTIAL_TEXTS.outerSpace}</SectionMessage>
				</div>
			{/if}
			{#if fieldError !== null}
				<div id={ids.error}>
					<SectionMessage tone="error" compact live>{fieldError}</SectionMessage>
				</div>
			{/if}
			<div class="buttons">
				<button
					class="button-primary"
					type="submit"
					aria-busy={busy ? 'true' : undefined}
					aria-disabled={busy ? 'true' : undefined}
				>
					{busy ? CREDENTIAL_TEXTS.saving : CREDENTIAL_TEXTS.save}
				</button>
				<button class="button-secondary" type="button" onclick={() => void closeForm()}>
					{CREDENTIAL_TEXTS.cancel}
				</button>
			</div>
		</form>
	{/if}

	{#if done !== null}
		<SectionMessage tone="success" compact live>{done}</SectionMessage>
	{/if}
	{#if failure !== null}
		<SectionMessage tone={failure.tone} compact live problem={failure.problem}>
			{failure.message}
		</SectionMessage>
	{/if}

	<ConfirmDialog
		open={removing}
		title={CREDENTIAL_TEXTS.removeTitle(name)}
		confirmLabel={CREDENTIAL_TEXTS.removeConfirm}
		{busy}
		error={removeError}
		problem={removeProblem}
		onconfirm={() => void confirmRemove()}
		oncancel={() => {
			if (!busy) removing = false;
		}}
	>
		<p>
			{(variable?.channels.length ?? 0) > 0
				? CREDENTIAL_TEXTS.removeUsedBy(variable?.channels ?? [])
				: CREDENTIAL_TEXTS.removeUnused}
		</p>
		<p>{CREDENTIAL_TEXTS.removeEffect}</p>
	</ConfirmDialog>

	<ConfirmDialog
		open={asking}
		title={CREDENTIAL_TEXTS.restartTitle}
		confirmLabel={CREDENTIAL_TEXTS.restartNow}
		cancelLabel={CREDENTIAL_TEXTS.restartLater}
		onconfirm={() => void restartNow()}
		oncancel={() => (asking = false)}
	>
		<p>{CREDENTIAL_TEXTS.restartText}</p>
	</ConfirmDialog>

	{#if restartHere}
		<RestartAction
			store={restart}
			{place}
			hint={CREDENTIAL_TEXTS.restartHint}
			onstart={onrestart}
			onrestarted={() => {
				void store.refreshNotice();
				void store.load();
				onrestarted?.();
			}}
		/>
	{/if}
</div>

<style>
	.credential {
		display: grid;
		gap: 0.5rem;
		min-width: 0;
		font-size: var(--font-size-control);
	}

	.head {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.75rem;
		align-items: baseline;
		justify-content: space-between;
	}

	code {
		overflow-wrap: anywhere;
	}

	.state {
		font-weight: 600;
	}

	.label,
	.hint,
	.note {
		color: var(--color-text-muted);
	}

	.actions,
	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}

	.form {
		display: grid;
		gap: 0.5rem;
		min-width: 0;
	}

	label {
		font-weight: 600;
	}

	input {
		min-width: 0;
		max-width: 100%;
	}
</style>
