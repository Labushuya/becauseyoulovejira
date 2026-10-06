<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import ErrorIcon from '$lib/components/ErrorIcon.svelte';
	import NewTicketForm from '$lib/components/NewTicketForm.svelte';
	import Drawer from '$lib/components/overlay/Drawer.svelte';
	import { toDataError } from '$lib/data/errors';
	import { CHANNEL_LABELS, ticketPrefill, type InboxItem } from '$lib/domain/inbox';
	import { parseListQuery } from '$lib/domain/list-query';
	import { joinedSeries, type RepeatRequest } from '$lib/domain/recurrence-rule';
	import { itemSuggestion } from '$lib/domain/rrule';
	import { targetOfItem, targetPrefill } from '$lib/domain/target-project';
	import type { TicketExtras } from '$lib/domain/ticket-create';
	import type { TicketDraft } from '$lib/domain/ticket';
	import { getCatalogStore } from '$lib/stores/catalog.svelte';
	import { findDayPlanEntryStore } from '$lib/stores/day-plan.svelte';
	import { getInboxStore } from '$lib/stores/inbox.svelte';
	import { findPinStore } from '$lib/stores/pins.svelte';
	import { getRecurrenceStore } from '$lib/stores/recurrence.svelte';
	import { getTicketDetailStore, type CreateResult } from '$lib/stores/ticket-detail.svelte';
	import { getTicketListStore } from '$lib/stores/ticket-list.svelte';
	import {
		convertFrom,
		inboxItemHref,
		listHref,
		ticketHref,
		withoutConvert
	} from '$lib/ticket-links';

	// "Neues Ticket" (E2 plan, T-8; E3 plan, T-13 and T-14; NT-1, ADR-0069): after creating, the panel
	// switches to the new ticket in place (replaceState), so "back" leads to the list and not to an
	// empty form. A list filtered by an active project chooses that project in advance ("ohne" is no
	// project ID and is ignored by the form). New tags come from the catalog, which reuses existing
	// names. With ?aus=<inbox entry> (E4 plan, T-3 and T-5) the same form comes filled from the entry,
	// the server converts the entry together with the ticket, and "Abbrechen" returns to the entry. The
	// target project of the entry (ADR-0049 §4) is chosen in advance unless it is archived or deleted;
	// the catalog says which.
	// Since NT-1 the ticket and everything of "Weitere Optionen" (sub-tasks, sources, the rule of a
	// series, pin, day plan) are created in one request, one transaction of the server, or nothing.
	// The page asks the server first which options it knows; before its restart after NT-1 it knows
	// none, and the ticket is created as before: the ticket, then the rule of an open section
	// "Wiederholen" with it as its instance (if that fails, the ticket stays and its panel offers
	// "Wiederholen…" with the same values). A calendar series may bring a rule (E5 plan, package 6;
	// ADR-0024 section 1).
	const detail = getTicketDetailStore();
	const rules = getRecurrenceStore();
	const catalog = getCatalogStore();
	const inbox = getInboxStore();
	const tickets = getTicketListStore();
	const pins = findPinStore();
	const dayPlans = findDayPlanEntryStore();
	const filteredProject = $derived(parseListQuery(page.url.searchParams).project);
	const convert = $derived(convertFrom(page.url));
	const support = $derived(detail.createSupport ?? null);
	/** New entries of the inbox that may become further sources, without the one converted here. */
	const candidates = $derived(
		support === null ? [] : (inbox.newItems ?? []).filter((item) => item.id !== convert)
	);

	$effect(() => {
		void detail.loadCreateSupport();
	});

	/** The entry to convert, once loaded; a handled entry is refused before the form opens. */
	let source = $state<
		| { state: 'loading'; id: string }
		| { state: 'ready'; item: InboxItem }
		| { state: 'refused'; id: string; message: string }
		| null
	>(null);

	$effect(() => {
		const id = convert;
		if (id === null) {
			source = null;
			return;
		}
		const controller = new AbortController();
		source = { state: 'loading', id };
		inbox.fetch(id, { signal: controller.signal }).then(
			(item) => {
				if (controller.signal.aborted) return;
				source =
					item.state === 'new'
						? { state: 'ready', item }
						: { state: 'refused', id, message: 'Dieser Eintrag wurde schon bearbeitet.' };
			},
			(error: unknown) => {
				if (controller.signal.aborted) return;
				const failure = toDataError(error);
				if (failure.kind === 'aborted') return;
				source = { state: 'refused', id, message: failure.message };
			}
		);
		return () => controller.abort();
	});

	async function create(
		draft: TicketDraft,
		recurrence: RepeatRequest | null,
		extras: TicketExtras
	): Promise<CreateResult> {
		const itemId = source?.state === 'ready' ? source.item.id : null;
		const result =
			support === null
				? await createAsBefore(draft, itemId, recurrence)
				: await detail.createWithOptions({
						draft,
						sourceItem: itemId,
						recurrence:
							recurrence === null
								? null
								: rules.ruleParams(recurrence, extras.templateSubtasks ? extras.subtasks : []),
						extras: {
							subtasks: extras.subtasks,
							ticketSources: extras.ticketSources,
							sources: extras.sources,
							pin: extras.pin,
							dayPlan: extras.dayPlan
						}
					});
		if (!result.ok) return result;
		// A ticket created one by one is read (ADR-0015 section 3).
		void tickets.markRead(result.ticket);
		if (result.rule) rules.upsert(result.rule);
		if (itemId !== null) {
			inbox.markConverted(itemId, result.ticket.id, result.ticket.created);
			tickets.announce(`Ticket ${result.ticket.key} angelegt.`);
		}
		return result;
	}

	/** Before the restart of the server after NT-1: the ticket, then the rule with it (two steps). */
	async function createAsBefore(
		draft: TicketDraft,
		itemId: string | null,
		recurrence: RepeatRequest | null
	): Promise<CreateResult> {
		const result = await detail.create(draft, itemId === null ? undefined : { sourceItem: itemId });
		if (result.ok && recurrence !== null) {
			const rule = await rules.repeatCreated(result.ticket, recurrence);
			if (rule !== null) {
				const joined = joinedSeries(result.ticket, rule.id, recurrence.values, tickets.today);
				detail.upsert(joined);
				tickets.upsert(joined);
			}
		}
		return result;
	}
</script>

<svelte:head>
	<title>Neues Ticket · becauseyoulovejira</title>
</svelte:head>

{#snippet form(item: InboxItem | null)}
	<NewTicketForm
		projects={catalog.activeProjects}
		initialProject={item === null ? filteredProject : null}
		tags={catalog.tags}
		prefill={item === null ? null : ticketPrefill(item)}
		target={item === null ? null : targetPrefill(targetOfItem(item, catalog.projects))}
		sourceLabel={item === null ? null : CHANNEL_LABELS[item.channel]}
		suggestion={item === null || rules.state === 'unavailable'
			? null
			: itemSuggestion(item, tickets.today)}
		repeat={rules.state !== 'unavailable'}
		eachAvailable={rules.eachReady}
		statusAvailable={rules.statusReady}
		subtasksAvailable={rules.subtasksReady}
		colorsAvailable={catalog.colorsReady}
		charmsAvailable={rules.charmsReady}
		assignmentAvailable={rules.assigneesReady}
		extrasAvailable={support !== null}
		kindAvailable={support?.kind ?? false}
		pinAvailable={(support?.pin ?? false) && (pins?.available ?? false)}
		dayPlanAvailable={(support?.dayPlan ?? false) && dayPlans !== null}
		ticketSourcesAvailable={support?.ticketSources ?? false}
		{candidates}
		today={tickets.today}
		oncreatetag={(name) => catalog.ensureTag(name)}
		oncreate={create}
		oncreated={(id) =>
			goto(ticketHref(id, item === null ? page.url : withoutConvert(page.url)), {
				replaceState: true
			})}
		oncancel={() =>
			goto(item === null || convert === null ? listHref(page.url) : inboxItemHref(convert))}
	/>
{/snippet}

{#if convert === null}
	{@render form(null)}
{:else if source?.state === 'ready'}
	{#key source.item.id}
		{@render form(source.item)}
	{/key}
{:else if source?.state === 'refused'}
	{@const refused = source}
	<Drawer labelledby="convert-refused" onclose={() => goto(inboxItemHref(refused.id))}>
		{#snippet context()}Aus dem Eingang{/snippet}
		<h2 id="convert-refused" tabindex="-1">Neues Ticket</h2>
		<p class="alert-error"><ErrorIcon /><span>{refused.message}</span></p>
		<a href={inboxItemHref(refused.id)}>Zum Eintrag im Eingang</a>
	</Drawer>
{:else}
	<Drawer labelledby="convert-loading" onclose={() => goto(listHref(page.url))}>
		{#snippet context()}Aus dem Eingang{/snippet}
		<h2 id="convert-loading" class="visually-hidden">Neues Ticket</h2>
		<p class="loading" role="status">Eintrag wird geladen …</p>
	</Drawer>
{/if}

<style>
	h2 {
		font-size: 1.125rem;
		font-weight: 600;
	}

	a {
		color: var(--color-brand-text);
	}

	.loading {
		color: var(--color-text-muted);
	}
</style>
