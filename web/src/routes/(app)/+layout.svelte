<script lang="ts">
	import { untrack } from 'svelte';
	import { afterNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import { auth } from '$lib/auth.svelte';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import ShortcutsModal from '$lib/components/help/ShortcutsModal.svelte';
	import FlagGroup from '$lib/components/overlay/FlagGroup.svelte';
	import QuickCapture from '$lib/components/QuickCapture.svelte';
	import { isHelpKey, isQuickCaptureKey, isTypingTarget } from '$lib/domain/keyboard';
	import { pb } from '$lib/pocketbase';
	import { setQuickCaptureOpener } from '$lib/quick-capture-context';
	import { startTour } from '$lib/tour/tour';
	import { setTourStarter } from '$lib/tour/tour-context';
	import {
		panelFreeTicketCreate,
		quickTicketData,
		saveQuickEntry,
		type CaptureDeps
	} from '$lib/stores/capture';
	import { CatalogStore, catalogData, setCatalogStore } from '$lib/stores/catalog.svelte';
	import { ColumnPrefsRegistry, setColumnPrefsRegistry } from '$lib/stores/column-prefs.svelte';
	import { FirstStepsStore, localStore, setFirstStepsStore } from '$lib/stores/first-steps.svelte';
	import { FlagStore, setFlagStore } from '$lib/stores/flags.svelte';
	import { InboxStore, inboxData, setInboxStore } from '$lib/stores/inbox.svelte';
	import { LastViewStore, sessionStore, setLastViewStore } from '$lib/stores/last-view.svelte';
	import { liveSource } from '$lib/stores/realtime';
	import { PanelShell, setPanelShell } from '$lib/overlay/panel-host.svelte';
	import {
		RecurrenceStore,
		recurrenceData,
		recurrenceLive,
		setRecurrenceStore
	} from '$lib/stores/recurrence.svelte';
	import {
		TicketActivityStore,
		setTicketActivityStore,
		ticketActivityData
	} from '$lib/stores/ticket-activity.svelte';
	import {
		TicketDetailStore,
		setTicketDetailStore,
		ticketDetailData
	} from '$lib/stores/ticket-detail.svelte';
	import {
		TicketSourcesStore,
		setTicketSourcesStore,
		ticketSourcesData
	} from '$lib/stores/ticket-sources.svelte';
	import {
		TicketListStore,
		readsData,
		setTicketListStore,
		ticketListData
	} from '$lib/stores/ticket-list.svelte';
	import { inboxItemHref, ticketPath } from '$lib/ticket-links';

	// Shell of every signed-in page (E2 plan, T-4). The root layout renders it only with a
	// session; the login page stays outside this group.
	let { children } = $props();

	// Stores live per layout instance (ADR-0006 section 1): a logout removes the layout and with
	// it every loaded ticket, project and tag.
	const catalog = setCatalogStore(new CatalogStore(catalogData(pb), auth));
	// Flags bottom left (ADR-0025 section 8): results and "Rückgängig" of the list and the inbox.
	const flags = setFlagStore(new FlagStore());
	// A side panel over the view (below 64rem, UI-6b) makes the header inert as well.
	const panelShell = setPanelShell(new PanelShell());
	$effect(() => () => flags.clear());
	// Widths and visibility of the table columns on this device (ADR-0030 section 5); other tabs
	// follow through the storage event, "Standard wiederherstellen" reports as a flag.
	const columnPrefs = setColumnPrefsRegistry(new ColumnPrefsRegistry(window, flags));
	$effect(() => untrack(() => columnPrefs.connect()));
	// The last view outside the settings, for "Zurück zu …" there (ADR-0026 section 1, EH-1): every
	// shown address is offered, the store keeps only views (no settings, no full view).
	const lastView = setLastViewStore(new LastViewStore(sessionStore, () => page.url.origin));
	afterNavigate(({ to }) => {
		if (to) lastView.remember(to.url);
	});
	// The column sort "Projekt" resolves projects through the catalog (E3 plan, package 9); the
	// "new" mark follows the own read rows and base line (E4 plan, package 4).
	const tickets = setTicketListStore(
		new TicketListStore(ticketListData(pb), auth, {
			projectOf: (ticket) => catalog.projectOf(ticket),
			// A project filter takes the sub projects in (ADR-0034).
			subProjectsOf: (projectId) => catalog.subProjectsOf(projectId).map((project) => project.id),
			reads: readsData(pb),
			flags
		})
	);
	const detail = setTicketDetailStore(new TicketDetailStore(ticketDetailData(pb), auth, tickets));
	// The inbox (E4 plan, T-4): new entries in full, for the view and the count at the switch.
	const inbox = setInboxStore(new InboxStore(inboxData(pb), auth, flags));
	const activity = setTicketActivityStore(
		new TicketActivityStore(ticketActivityData(pb), auth, () => auth.userId)
	);
	// Sources of the open ticket and the linking of inbox entries (ADR-0031): changed entries go
	// to the inbox at once, before their realtime event.
	const sources = setTicketSourcesStore(
		new TicketSourcesStore(ticketSourcesData(pb), auth, flags, (item) => inbox.upsert(item))
	);
	// Recurrence rules (E5 plan, T-7): all of them, for the table, the panel and the overview;
	// results of their actions go out as flags (package 5).
	const rules = setRecurrenceStore(new RecurrenceStore(recurrenceData(pb), auth, flags));
	$effect(() => untrack(() => rules.start()));
	$effect(() => untrack(() => rules.connect(recurrenceLive(pb))));

	// Session care while the app is shown (ADR-0007 section 1). The returned cleanup removes the
	// timer and the listeners when the layout goes away (logout, session end). untrack: the
	// keep-alive must not restart when session state it reads changes.
	$effect(() => untrack(() => auth.keepAlive()));

	// Clock of "today" for the list order (T-3); the cleanup also empties the store.
	$effect(() => untrack(() => tickets.start()));

	// Projects and tags, loaded once per session (E3 plan, T-16); the cleanup empties the catalog.
	$effect(() => untrack(() => catalog.start()));

	// New inbox entries, loaded once per session; the cleanup empties the inbox.
	$effect(() => untrack(() => inbox.start()));

	// Live updates (ADR-0007 section 2): list, panel, comments, history, catalog and inbox. The
	// cleanups end every subscription when the layout goes away; a logout has already ended them.
	const live = liveSource(pb);
	$effect(() => untrack(() => tickets.connect(live)));
	$effect(() => untrack(() => detail.connect(live)));
	$effect(() => untrack(() => activity.connect(live)));
	$effect(() => untrack(() => catalog.connect(live)));
	$effect(() => untrack(() => inbox.connect(live)));
	$effect(() => untrack(() => sources.connect(live)));

	// Quick entry (E4 plan, T-11 and package 6): one key handler for the whole app. `c` and Ctrl+K
	// open it, but not while the user types, picks a tag, searches, or a dialog or popover is open;
	// only then does Ctrl+K lose the search of the browser. Tickets get the source "quick" and join
	// the list without touching an open panel.
	let quickOpen = $state(false);
	const quickDeps: CaptureDeps = {
		ensureTag: (name) => catalog.ensureTag(name),
		createTicket: panelFreeTicketCreate(quickTicketData(pb), auth, tickets),
		createItem: (draft) => inbox.create(draft),
		markRead: (ticket) => tickets.markRead(ticket)
	};
	// Empty states offer "Schnellerfassung (c)" through the context (plan EH-11).
	setQuickCaptureOpener(() => (quickOpen = true));

	// "Erste Schritte" (plan EH-12): the steps are marked where the app sees them. Opening the quick
	// entry counts as trying it; an open ticket and a project are read from the stores here, a
	// channel on the page "Kanäle", the tour where it starts (EH-13).
	const firstSteps = setFirstStepsStore(new FirstStepsStore(localStore));
	$effect(() => {
		if (quickOpen) untrack(() => firstSteps.reach('quick'));
	});
	$effect(() => {
		if (tickets.openState === 'ready' && tickets.openCount > 0) {
			untrack(() => firstSteps.reach('ticket'));
		}
	});
	$effect(() => {
		if (catalog.projects.length > 0) untrack(() => firstSteps.reach('project'));
	});

	// Guided tour (plan EH-13, ADR-0026 section 8): only on a click in the help menu or in "Erste
	// Schritte", never on its own. It closes open popovers first, returns the focus to the element
	// that started it and runs without animation for reduced motion.
	let touring = false;
	async function startGuidedTour() {
		if (touring) return;
		touring = true;
		firstSteps.reach('tour');
		const active = document.activeElement;
		const trigger = active instanceof HTMLElement && active !== document.body ? active : null;
		for (const element of document.querySelectorAll<HTMLElement>('[popover]')) {
			try {
				if (element.matches(':popover-open')) element.hidePopover();
			} catch {
				// Runtimes without :popover-open have no open popover.
			}
		}
		try {
			await startTour({
				trigger,
				currentPath: () => page.url.pathname,
				navigate: (path) => goto(path),
				reducedMotion: () =>
					typeof window.matchMedia === 'function' &&
					window.matchMedia('(prefers-reduced-motion: reduce)').matches
			});
		} catch {
			flags.show({ tone: 'error', title: 'Die Einführung ließ sich nicht starten.' });
		} finally {
			touring = false;
		}
	}
	setTourStarter(() => void startGuidedTour());

	// Modal "Tastaturkürzel" (plan EH-9): `?` opens it under the same conditions as `c`, the help
	// menu in the header as well.
	let shortcutsOpen = $state(false);

	function onkeydown(event: KeyboardEvent) {
		if (quickOpen || shortcutsOpen || event.defaultPrevented) return;
		const quick = isQuickCaptureKey(event);
		if ((!quick && !isHelpKey(event)) || isTypingTarget(event)) return;
		event.preventDefault();
		if (quick) quickOpen = true;
		else shortcutsOpen = true;
	}
</script>

<svelte:window {onkeydown} />

<AppHeader
	covered={panelShell.covering}
	openCount={tickets.openState === 'ready' ? tickets.openCount : null}
	onquick={() => (quickOpen = true)}
	onshortcuts={() => (shortcutsOpen = true)}
	ontour={() => void startGuidedTour()}
/>
<main class="content">
	{@render children()}
</main>
<FlagGroup store={flags} />

{#if quickOpen}
	<QuickCapture
		projects={catalog.projects}
		tags={catalog.tags}
		onsave={(entry, target) => saveQuickEntry(entry, target, quickDeps)}
		onclose={() => (quickOpen = false)}
		resultHref={(target, id) => (target === 'ticket' ? ticketPath(id) : inboxItemHref(id))}
	/>
{/if}

{#if shortcutsOpen}
	<ShortcutsModal onclose={() => (shortcutsOpen = false)} />
{/if}

<style>
	/* The embedded side panel reaches over this padding to the edges of the window (UI-6b). */
	.content {
		--content-padding: 1.5rem;
		padding: var(--content-padding);
	}
</style>
