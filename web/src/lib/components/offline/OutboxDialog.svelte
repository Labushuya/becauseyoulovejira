<script lang="ts">
	import { untrack } from 'svelte';
	import type { ResolvedPathname } from '$app/types';
	import {
		CLOCK_CODE,
		DAY_OVER_CODE,
		OFFLINE_TEXTS,
		OPEN_CHILDREN_CODE,
		actionName,
		actionText,
		canCompleteAnyway,
		canReopenAnyway,
		commentExcerpt,
		createdRecordOf,
		createdTitleOf,
		deviceTimeText,
		dueOfServer,
		intentOf,
		isBroken,
		isCommentCreate,
		isCreateAction,
		isDueAction,
		isInboxCreate,
		isSetAside,
		isTakeBack,
		isTicketCreate,
		isWaiting,
		needsDecision,
		reasonOf,
		serverTimeText,
		ticketOf,
		unknownChildren,
		withoutFieldOf,
		writesOf,
		type Feature,
		type KeptAction
	} from '$lib/domain/offline';
	import { formatCalendarDate } from '$lib/domain/format';
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
	// question; a refusal its reason with "Details"; one older than 48 hours or with a time of the
	// device in the future (OF-2b) "Trotzdem übertragen". Since OF-3 also the due date and the check
	// marks of the day plan: a check mark of a day gone by asks "… trotzdem erledigen?" for a task and
	// lapses otherwise, a changed check mark is refused; a change taken back after it may have arrived
	// says that it is taken back once there is a connection, its counter action stands as "Rücknahme".
	// Since OF-3b a discarded change says so only while a take-back stands behind it, else that a
	// later change sets the value; one the server refused with 403 or 404 says that it may have
	// arrived; taking back a completion on a day gone by asks "… trotzdem wieder öffnen?". Since round 2
	// a take-back that waits or is sent has no "Verwerfen" and says how to decide otherwise, and a
	// discarded completion names sub-tasks whose status before is unknown. The buttons run steps of the
	// outbox that never reject; a failing storage shows its own flag (OF-2b). It opens only through
	// "Ansehen" or the symbol in the top bar, never on its own (ADR-0025).
	// Since OF-4a a creation of "＋" stands as "Neues Ticket" or "Neuer Eingangseintrag" with its whole
	// title, readable and selectable until the user decides (C2); refused at its project or its tags it
	// offers "Ohne Projekt anlegen" or "Ohne Tags anlegen" (concept §3.7); discarded after it may have
	// arrived it says that it is looked up, never sent again (C4).
	// Since OF-4b a comment stands as "Kommentar zu HAUS-12" (or "… zu Neu „Titel“") with the beginning
	// of its text; waiting for a decision (refused, set aside with its discarded ticket, older than 48
	// hours) it shows its whole text, readable and selectable (the clipboard is blocked over HTTP), with
	// "Als Eingangseintrag sichern" and "Verwerfen" (concept §2.1, C2). A creation of a ticket names the
	// comments that wait for it and what "Verwerfen" does to them.
	// Since round 2 of OF-4b an entry that keeps the text of a comment shows that whole text the same way
	// in every state (K-1); "Als Eingangseintrag sichern" waits with `aria-busy` and `aria-disabled` while
	// it runs (K-2); a comment saved after it may have arrived says that it is looked up (K-3).
	let {
		outbox,
		onclose,
		ticketHref,
		itemHref,
		changedBy
	}: {
		outbox: OutboxStore;
		onclose: () => void;
		/** The address of the ticket in the view of the tab. */
		ticketHref: (id: string) => ResolvedPathname;
		/** The address of an entry of the inbox (OF-4a); without it a creation of one has no link. */
		itemHref?: (id: string) => ResolvedPathname;
		/** Who changed the field meanwhile (from the history), null when unknown. */
		changedBy?: (action: KeptAction) => Promise<string | null>;
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

	function timeOf(action: KeptAction): string {
		return deviceTimeText(action.createdAt, now);
	}

	/** Whether `action` changes one of `features`. */
	function changesAny(action: KeptAction, features: Iterable<Feature>): boolean {
		const changes = writesOf(action);
		return [...features].some((feature) => changes.has(feature));
	}

	/**
	 * A discarded change says "verworfen, es gilt die spätere Änderung" only where a later change the
	 * user keeps sets its value and no take-back after it covers it (OF-3b, round 2: of two discarded
	 * ones both are taken back).
	 */
	function discardedText(action: KeptAction): string {
		const covered = actions.some(
			(other) =>
				isTakeBack(other) &&
				(other.undoes === action.op ||
					(other.seq > action.seq && changesAny(action, writesOf(other).keys())))
		);
		const later = actions.some(
			(other) =>
				other.seq > action.seq &&
				other.discarded !== true &&
				!isTakeBack(other) &&
				changesAny(action, intentOf(other).keys())
		);
		return !covered && later ? OFFLINE_TEXTS.discardedLater : OFFLINE_TEXTS.takingBack;
	}

	function stateText(action: KeptAction): string {
		if (!isWaiting(action)) return OFFLINE_TEXTS.markDecision;
		// A discarded creation is only looked up by its ID (OF-4a, C4).
		if (action.discarded === true && isCreateAction(action)) {
			// A comment saved as an entry after it may have arrived says so (round 2, K-3).
			if (isCommentCreate(action) && action.saved === true) {
				return OFFLINE_TEXTS.savedChecking(outbox.offline);
			}
			// With a connection in neutral words (OF-4b, B-3): it waits for its next lookup.
			return OFFLINE_TEXTS.createChecking(outbox.offline);
		}
		if (action.discarded === true) return discardedText(action);
		if (action.state === 'sending') return OFFLINE_TEXTS.underway;
		const blocker = actions.find(
			(other) => action.dependsOn.includes(other.op) && needsDecision(other)
		);
		if (blocker === undefined) return OFFLINE_TEXTS.waiting;
		// "wartet auf das neue Ticket „…“" in the middle of the sentence (OF-4a round 2, A10), "wartet
		// auf den Kommentar „…“" (OF-4b).
		const record = createdRecordOf(blocker);
		if (isCreateAction(blocker) && record !== null) {
			return OFFLINE_TEXTS.waitingForCreated(record, createdTitleOf(blocker));
		}
		return OFFLINE_TEXTS.waitingFor(actionName(blocker) || 'Ticket');
	}

	/** The comments that wait for the creation of a ticket "＋" created (OF-4b). */
	function commentsOf(action: KeptAction): number {
		if (!isTicketCreate(action)) return 0;
		return actions.filter(
			(other) => isCommentCreate(other) && other.dependsOn.includes(action.op) && !isSetAside(other)
		).length;
	}

	function metaText(action: KeptAction): string {
		return `${OFFLINE_TEXTS.offlineAt(timeOf(action))} · ${stateText(action)}`;
	}

	/**
	 * What the action does; a counter action of "Verwerfen" says that it takes back (OF-3); a creation
	 * of "＋" what it creates, its title follows in full (OF-4a).
	 */
	function whatText(action: KeptAction): string {
		if (isBroken(action)) return OFFLINE_TEXTS.broken;
		if (isCommentCreate(action)) return OFFLINE_TEXTS.commentOn(action.key, action.title);
		if (isCreateAction(action)) {
			return isInboxCreate(action) ? OFFLINE_TEXTS.newItem : OFFLINE_TEXTS.newTicket;
		}
		const text = actionText(action);
		return action.undoes === undefined ? text : OFFLINE_TEXTS.counter(text);
	}

	/** Where "Ticket öffnen" leads: the ticket, or an entry of the inbox "＋" created (OF-4a). */
	function hrefOf(action: KeptAction): ResolvedPathname | null {
		if (isInboxCreate(action)) return itemHref === undefined ? null : itemHref(action.target);
		return ticketHref(ticketOf(action));
	}

	function mineText(action: KeptAction): string {
		return OFFLINE_TEXTS.conflictMine(timeOf(action), actionText(action));
	}

	function nowText(action: KeptAction): string {
		const actual = action.outcome?.actual;
		const time = serverTimeText(action.outcome?.updated, now);
		const who = names[action.op] ?? null;
		if (isDueAction(action)) {
			const due = dueOfServer(actual);
			return OFFLINE_TEXTS.conflictDueNow(who, due ? formatCalendarDate(due) : null, time);
		}
		const status = isStatus(actual) ? STATUS_LABELS[actual] : (actual ?? '–');
		return OFFLINE_TEXTS.conflictNow(who, status, time);
	}

	function asksChildren(action: KeptAction): boolean {
		return action.state === 'refused' && action.outcome?.code === OPEN_CHILDREN_CODE;
	}

	/** A check mark of a day gone by (OF-3): a task asks, every other one lapses. */
	function dayOver(action: KeptAction): boolean {
		return action.state === 'refused' && action.outcome?.code === DAY_OVER_CODE;
	}

	/** Why a change was not sent on its own: older than 48 hours, or the clock (OF-2b). */
	function expiredHint(action: KeptAction): string {
		return action.outcome?.code === CLOCK_CODE
			? OFFLINE_TEXTS.clockHint
			: OFFLINE_TEXTS.expiredHint;
	}
</script>

{#snippet discard(action: KeptAction, lockedBy: string | null = null)}
	<!-- Locked while the comment is saved as an entry (MO-7a, L-1): it stays, with the reason. -->
	<button
		class="button-secondary button-small"
		type="button"
		aria-disabled={lockedBy !== null ? 'true' : undefined}
		aria-describedby={lockedBy ?? undefined}
		title={lockedBy !== null ? OFFLINE_TEXTS.savingAsItemLocked : undefined}
		onclick={() => {
			if (lockedBy === null) void outbox.discard(action.op);
		}}
	>
		{OFFLINE_TEXTS.discard}
	</button>
{/snippet}

{#snippet open(action: KeptAction)}
	{@const href = hrefOf(action)}
	{#if href !== null}
		<a class="button-subtle button-small" {href} onclick={onclose}>
			{isInboxCreate(action) ? OFFLINE_TEXTS.openItem : OFFLINE_TEXTS.openTicket}
		</a>
	{/if}
{/snippet}

<!-- A comment that waits for a decision (OF-4b, C2): its whole text and how to keep it. -->
{#snippet decideComment(action: KeptAction)}
	{#if isCommentCreate(action)}
		<blockquote class="comment-text">{action.payload.body}</blockquote>
		<p class="detail">
			{action.state === 'expired' ? expiredHint(action) : reasonOf(action)}
		</p>
		<ProblemDetails problem={outbox.problemOf(action.op)} />
		{@const saving = outbox.savingAsItem(action.op)}
		{@const lockedBy = saving ? `${uid}-saving-${action.op}` : null}
		<div class="buttons">
			{#if outbox.canSaveAsItem(action) || saving}
				<!-- While it runs the button stays and waits (round 2, K-2): a second tap saves nothing. -->
				<button
					class="button-primary button-small"
					type="button"
					aria-disabled={saving ? 'true' : undefined}
					aria-busy={saving ? 'true' : undefined}
					onclick={() => {
						if (!saving) void outbox.saveAsItem(action.op);
					}}
				>
					{OFFLINE_TEXTS.saveAsItem}
				</button>
			{/if}
			{#if action.state === 'expired'}
				<!-- Locked while the comment is saved as an entry (MO-7a, L-1), with the reason. -->
				<button
					class="button-secondary button-small"
					type="button"
					aria-disabled={lockedBy !== null ? 'true' : undefined}
					aria-describedby={lockedBy ?? undefined}
					title={lockedBy !== null ? OFFLINE_TEXTS.savingAsItemLocked : undefined}
					onclick={() => {
						if (lockedBy === null) void outbox.sendAnyway(action.op);
					}}
				>
					{OFFLINE_TEXTS.sendAnyway}
				</button>
			{/if}
			{@render discard(action, lockedBy)}
			{#if !isSetAside(action)}
				{@render open(action)}
			{/if}
		</div>
		{#if lockedBy !== null}
			<span class="visually-hidden" id={lockedBy}>{OFFLINE_TEXTS.savingAsItemLocked}</span>
		{/if}
	{/if}
{/snippet}

<Modal open size="m" title={OFFLINE_TEXTS.dialogTitle} describedBy={`${uid}-intro`} {onclose}>
	<p class="intro" id={`${uid}-intro`}>{intro}</p>
	{#if actions.length > 0}
		<ul class="actions">
			{#each actions as action (action.op)}
				<li class="action" data-outbox-action={action.state}>
					<p class="what">
						<span class="text">{whatText(action)}</span>
						{#if isCommentCreate(action)}
							<!-- The beginning of the text names the comment (OF-4b). -->
							<span class="title">„{commentExcerpt(action.payload.body)}“</span>
						{:else if action.title !== ''}<span class="title">{action.title}</span>{/if}
					</p>
					{#if !isBroken(action)}
						<p class="meta">{metaText(action)}</p>
					{/if}
					{#if commentsOf(action) > 0}
						<p class="detail">{OFFLINE_TEXTS.withComments(commentsOf(action))}</p>
					{/if}
					{#if isInboxCreate(action) && action.payload.body !== undefined}
						<!-- The whole text of a comment an entry keeps (round 2, K-1, C2): readable and
						     selectable until it arrived, waiting, refused or older than 48 hours. -->
						<blockquote class="comment-text">{action.payload.body}</blockquote>
					{/if}
					{#if isCommentCreate(action) && needsDecision(action) && action.discarded !== true}
						{@render decideComment(action)}
					{:else if action.state === 'conflict'}
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
					{:else if dayOver(action)}
						<!-- A day gone by (decision of the user 3): a task may still be completed, and taking a
						     completion back may still open the ticket again (OF-3b). -->
						{#if canCompleteAnyway(action)}
							<p class="detail">{OFFLINE_TEXTS.dayOverDone(action.key || 'Ticket')}</p>
						{:else if canReopenAnyway(action)}
							<p class="detail">{OFFLINE_TEXTS.dayOverReopen(action.key || 'Ticket')}</p>
						{:else}
							<p class="detail">{OFFLINE_TEXTS.dayOverLapsed}</p>
						{/if}
						<ProblemDetails problem={outbox.problemOf(action.op)} />
						<div class="buttons">
							{#if canCompleteAnyway(action)}
								<button
									class="button-primary button-small"
									type="button"
									onclick={() => void outbox.completeAnyway(action.op)}
								>
									{OFFLINE_TEXTS.force}
								</button>
							{:else if canReopenAnyway(action)}
								<button
									class="button-primary button-small"
									type="button"
									onclick={() => void outbox.reopenAnyway(action.op)}
								>
									{OFFLINE_TEXTS.reopenAnyway}
								</button>
							{/if}
							{@render discard(action)}
						</div>
					{:else if action.state === 'refused'}
						{#if !isBroken(action)}
							<p class="detail">{reasonOf(action)}</p>
						{/if}
						{#if action.discarded === true}
							<!-- Refused with 403 or 404 after "Verwerfen" (OF-3b): it may stay in effect. -->
							<p class="detail">{OFFLINE_TEXTS.refusedMaybeArrived}</p>
						{/if}
						<ProblemDetails problem={outbox.problemOf(action.op)} />
						<div class="buttons">
							{#if withoutFieldOf(action) !== null}
								{@const field = withoutFieldOf(action) ?? 'project'}
								<!-- Concept §3.7: where it goes, a choice instead of only "Verwerfen" (OF-4a). -->
								<button
									class="button-primary button-small"
									type="button"
									onclick={() => void outbox.createWithout(action.op, field)}
								>
									{field === 'project' ? OFFLINE_TEXTS.withoutProject : OFFLINE_TEXTS.withoutTags}
								</button>
							{/if}
							{@render discard(action)}
							{#if !isBroken(action) && action.target !== ''}
								{@render open(action)}
							{/if}
						</div>
					{:else if action.state === 'expired'}
						<p class="detail">{expiredHint(action)}</p>
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
					{:else if isTakeBack(action)}
						<!-- A take-back carries out "Verwerfen" and has none of its own (round 2, S2). -->
						<p class="detail">{OFFLINE_TEXTS.takeBackHint}</p>
					{:else if action.discarded === true}
						{@const unknown = unknownChildren(action).length}
						{#if unknown > 0}
							<p class="detail">{OFFLINE_TEXTS.childrenUnknown(unknown)}</p>
						{/if}
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

	/*
	 * The whole text of a comment that waits for a decision (OF-4b), and since round 2 of an entry that
	 * keeps one (K-1): plain, selectable text.
	 */
	.comment-text {
		margin: 0.25rem 0;
		padding: 0.375rem 0.625rem;
		font-size: var(--font-size-body);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		user-select: text;
		border-left: 3px solid var(--color-line);
	}

	a {
		text-decoration: none;
	}
</style>
