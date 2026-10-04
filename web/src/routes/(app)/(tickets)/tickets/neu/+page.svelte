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
	import type { TicketDraft } from '$lib/domain/ticket';
	import { getCatalogStore } from '$lib/stores/catalog.svelte';
	import { getInboxStore } from '$lib/stores/inbox.svelte';
	import { getRecurrenceStore } from '$lib/stores/recurrence.svelte';
	import { getTicketDetailStore } from '$lib/stores/ticket-detail.svelte';
	import { getTicketListStore } from '$lib/stores/ticket-list.svelte';
	import {
		convertFrom,
		inboxItemHref,
		listHref,
		ticketHref,
		withoutConvert
	} from '$lib/ticket-links';

	// "Neues Ticket" (E2 plan, T-8; E3 plan, T-13 and T-14): after creating, the panel switches to
	// the new ticket in place (replaceState), so "back" leads to the list and not to an empty form.
	// A list filtered by an active project chooses that project in advance ("ohne" is no project
	// ID and is ignored by the form). New tags come from the catalog, which reuses existing names.
	// With ?aus=<inbox entry> (E4 plan, T-3 and T-5) the form comes filled from the entry, the
	// server converts the entry together with the ticket, and "Abbrechen" returns to the entry.
	// The target project of the entry (ADR-0049 §4) is chosen in advance unless it is archived or
	// deleted; the catalog says which.
	// A calendar series may bring a rule (E5 plan, package 6; ADR-0024 section 1), and since plan
	// OR-4 every new ticket can repeat from the start (section "Wiederholen", once the rules are
	// available): after the ticket the rule is created with it as its instance; if that fails, the
	// ticket stays and its panel offers "Wiederholen…" with the same values.
	const detail = getTicketDetailStore();
	const rules = getRecurrenceStore();
	const catalog = getCatalogStore();
	const inbox = getInboxStore();
	const tickets = getTicketListStore();
	const filteredProject = $derived(parseListQuery(page.url.searchParams).project);
	const convert = $derived(convertFrom(page.url));

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

	async function create(draft: TicketDraft, recurrence: RepeatRequest | null) {
		const itemId = source?.state === 'ready' ? source.item.id : null;
		const result = await detail.create(draft, itemId === null ? undefined : { sourceItem: itemId });
		// A ticket created one by one is read (ADR-0015 section 3).
		if (result.ok) void tickets.markRead(result.ticket);
		if (result.ok && itemId !== null) {
			inbox.markConverted(itemId, result.ticket.id, result.ticket.created);
			tickets.announce(`Ticket ${result.ticket.key} angelegt.`);
		}
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

{#if convert === null}
	<NewTicketForm
		projects={catalog.activeProjects}
		initialProject={filteredProject}
		tags={catalog.tags}
		repeat={rules.state !== 'unavailable'}
		eachAvailable={rules.eachReady}
		statusAvailable={rules.statusReady}
		subtasksAvailable={rules.subtasksReady}
		colorsAvailable={catalog.colorsReady}
		charmsAvailable={rules.charmsReady}
		today={tickets.today}
		oncreatetag={(name) => catalog.ensureTag(name)}
		oncreate={create}
		oncreated={(id) => goto(ticketHref(id, page.url), { replaceState: true })}
		oncancel={() => goto(listHref(page.url))}
	/>
{:else if source?.state === 'ready'}
	{#key source.item.id}
		<NewTicketForm
			projects={catalog.activeProjects}
			tags={catalog.tags}
			prefill={ticketPrefill(source.item)}
			target={targetPrefill(targetOfItem(source.item, catalog.projects))}
			sourceLabel={CHANNEL_LABELS[source.item.channel]}
			suggestion={rules.state === 'unavailable' ? null : itemSuggestion(source.item, tickets.today)}
			repeat={rules.state !== 'unavailable'}
			eachAvailable={rules.eachReady}
			statusAvailable={rules.statusReady}
			subtasksAvailable={rules.subtasksReady}
			colorsAvailable={catalog.colorsReady}
			charmsAvailable={rules.charmsReady}
			today={tickets.today}
			oncreatetag={(name) => catalog.ensureTag(name)}
			oncreate={create}
			oncreated={(id) => goto(ticketHref(id, withoutConvert(page.url)), { replaceState: true })}
			oncancel={() => goto(inboxItemHref(convert))}
		/>
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
