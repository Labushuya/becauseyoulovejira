<script lang="ts">
	import { untrack } from 'svelte';
	import type { ResolvedPathname } from '$app/types';
	import {
		OFFLINE_TEXTS,
		OPEN_CHILDREN_CODE,
		actionText,
		deviceTimeText,
		isBroken,
		isWaiting,
		needsDecision,
		reasonOf,
		serverTimeText,
		type OutboxAction
	} from '$lib/domain/offline';
	import { STATUS_LABELS } from '$lib/domain/labels';
	import { isStatus } from '$lib/domain/status';
	import type { OutboxStore } from '$lib/offline/outbox.svelte';
	import Modal from '../overlay/Modal.svelte';
	import ProblemDetails from '../problems/ProblemDetails.svelte';

	// Dialog "Gemerkte Änderungen" (OF-2, concept OF-0 §2.1): the Modal M, in the phone frame a
	// sheet (MO-1b). Each kept change in one row: what it does, the time of the device, how it
	// stands. A waiting one can be discarded (the flag offers "Rückgängig"); a conflict shows the
	// own change and what happened meanwhile with "Meine Änderung übernehmen" (sends again, now based
	// on the new value), "Verwerfen" and "Ticket öffnen"; open sub-tasks of a completion the known
	// question; a refusal its reason with "Details"; one older than 48 hours "Trotzdem übertragen".
	// It opens only through "Ansehen" or the symbol in the top bar, never on its own (ADR-0025).
	let {
		outbox,
		onclose,
		ticketHref,
		changedBy
	}: {
		outbox: OutboxStore;
		onclose: () => void;
		/** The address of the ticket in the view of the tab. */
		ticketHref: (id: string) => ResolvedPathname;
		/** Who changed the status meanwhile (from the history), null when unknown. */
		changedBy?: (action: OutboxAction) => Promise<string | null>;
	} = $props();

	const uid = $props.id();
	const now = Date.now();
	const actions = $derived(outbox.actions);
	const intro = $derived(
		actions.length === 0
			? OFFLINE_TEXTS.dialogEmpty
			: 'Diese Änderungen sind auf diesem Gerät gemerkt und werden über die normalen Wege übertragen.'
	);
	/** Names of who changed a ticket meanwhile, per action, once the history answered. */
	let names = $state<Record<string, string | null>>({});

	// A side effect: the history of a conflicted ticket is asked once for who changed it.
	$effect(() => {
		const ask = changedBy;
		const conflicted = actions.filter((action) => action.state === 'conflict');
		if (ask === undefined) return;
		untrack(() => {
			for (const action of conflicted) {
				if (action.op in names) continue;
				names[action.op] = null;
				void ask(action).then(
					(who) => (names[action.op] = who),
					() => undefined
				);
			}
		});
	});

	function timeOf(action: OutboxAction): string {
		return deviceTimeText(action.createdAt, now);
	}

	function stateText(action: OutboxAction): string {
		if (!isWaiting(action)) return OFFLINE_TEXTS.markDecision;
		if (action.state === 'sending') return OFFLINE_TEXTS.underway;
		const blocker = actions.find(
			(other) => action.dependsOn.includes(other.op) && needsDecision(other)
		);
		if (blocker !== undefined) return OFFLINE_TEXTS.waitingFor(blocker.key || 'Ticket');
		return OFFLINE_TEXTS.waiting;
	}

	function metaText(action: OutboxAction): string {
		return `${OFFLINE_TEXTS.offlineAt(timeOf(action))} · ${stateText(action)}`;
	}

	function mineText(action: OutboxAction): string {
		return OFFLINE_TEXTS.conflictMine(timeOf(action), actionText(action));
	}

	function nowText(action: OutboxAction): string {
		const actual = action.outcome?.actual;
		const status = isStatus(actual) ? STATUS_LABELS[actual] : (actual ?? '–');
		const time = serverTimeText(action.outcome?.updated, now);
		return OFFLINE_TEXTS.conflictNow(names[action.op] ?? null, status, time);
	}

	function asksChildren(action: OutboxAction): boolean {
		return action.state === 'refused' && action.outcome?.code === OPEN_CHILDREN_CODE;
	}
</script>

{#snippet discard(action: OutboxAction)}
	<button
		class="button-secondary button-small"
		type="button"
		onclick={() => void outbox.discard(action.op)}
	>
		{OFFLINE_TEXTS.discard}
	</button>
{/snippet}

{#snippet open(action: OutboxAction)}
	<a class="button-subtle button-small" href={ticketHref(action.target)} onclick={onclose}>
		{OFFLINE_TEXTS.openTicket}
	</a>
{/snippet}

<Modal open size="m" title={OFFLINE_TEXTS.dialogTitle} describedBy={`${uid}-intro`} {onclose}>
	<p class="intro" id={`${uid}-intro`}>{intro}</p>
	{#if actions.length > 0}
		<ul class="actions">
			{#each actions as action (action.op)}
				<li class="action" data-outbox-action={action.state}>
					<p class="what">
						<span class="text">{isBroken(action) ? OFFLINE_TEXTS.broken : actionText(action)}</span>
						{#if action.title !== ''}<span class="title">{action.title}</span>{/if}
					</p>
					{#if !isBroken(action)}
						<p class="meta">{metaText(action)}</p>
					{/if}
					{#if action.state === 'conflict'}
						<p class="detail">{mineText(action)}</p>
						<p class="detail">{nowText(action)}</p>
						<ProblemDetails problem={outbox.problemOf(action.op)} />
						<div class="buttons">
							<button
								class="button-primary button-small"
								type="button"
								onclick={() => void outbox.takeMine(action.op)}
							>
								{OFFLINE_TEXTS.takeMine}
							</button>
							{@render discard(action)}
							{@render open(action)}
						</div>
					{:else if asksChildren(action)}
						<p class="detail">{reasonOf(action)}</p>
						<div class="buttons">
							<button
								class="button-primary button-small"
								type="button"
								onclick={() => void outbox.answerChildren(action.op, 'complete_children')}
							>
								{OFFLINE_TEXTS.completeChildren}
							</button>
							<button
								class="button-secondary button-small"
								type="button"
								onclick={() => void outbox.answerChildren(action.op, 'force')}
							>
								{OFFLINE_TEXTS.force}
							</button>
							{@render discard(action)}
						</div>
					{:else if action.state === 'refused'}
						{#if !isBroken(action)}
							<p class="detail">{reasonOf(action)}</p>
						{/if}
						<ProblemDetails problem={outbox.problemOf(action.op)} />
						<div class="buttons">
							{@render discard(action)}
							{#if !isBroken(action) && action.target !== ''}
								{@render open(action)}
							{/if}
						</div>
					{:else if action.state === 'expired'}
						<p class="detail">{OFFLINE_TEXTS.expiredHint}</p>
						<div class="buttons">
							<button
								class="button-primary button-small"
								type="button"
								onclick={() => void outbox.sendAnyway(action.op)}
							>
								{OFFLINE_TEXTS.sendAnyway}
							</button>
							{@render discard(action)}
						</div>
					{:else if action.state === 'queued'}
						<div class="buttons">
							{@render discard(action)}
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#snippet footer({ close })}
		<button class="button-secondary" type="button" onclick={close}>Schließen</button>
	{/snippet}
</Modal>

<style>
	.intro,
	.meta,
	.title {
		color: var(--color-text-muted);
	}

	.intro {
		font-size: var(--font-size-small);
	}

	.actions {
		display: grid;
		gap: 0.75rem;
		margin-top: 0.75rem;
		list-style: none;
	}

	.action {
		display: grid;
		gap: 0.25rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--color-line);
	}

	.what {
		display: flex;
		flex-wrap: wrap;
		gap: 0 0.5rem;
		overflow-wrap: anywhere;
	}

	.text {
		font-weight: 600;
	}

	.meta,
	.detail {
		font-size: var(--font-size-small);
		overflow-wrap: anywhere;
	}

	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.25rem;
	}

	a {
		text-decoration: none;
	}
</style>
