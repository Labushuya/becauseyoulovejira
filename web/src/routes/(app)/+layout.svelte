<script lang="ts">
	import { untrack } from 'svelte';
	import { afterNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { auth } from '$lib/auth.svelte';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import AppUpdateNotice from '$lib/components/AppUpdateNotice.svelte';
	import LiveUpdateNotice from '$lib/components/LiveUpdateNotice.svelte';
	import ShortcutsModal from '$lib/components/help/ShortcutsModal.svelte';
	import FlagGroup from '$lib/components/overlay/FlagGroup.svelte';
	import QuickCapture from '$lib/components/QuickCapture.svelte';
	import { isHelpKey, isQuickCaptureKey, isTypingTarget } from '$lib/domain/keyboard';
	import { pb } from '$lib/pocketbase';
	import { setQuickCaptureOpener } from '$lib/quick-capture-context';
	import { securityLoginsHref } from '$lib/settings-sections';
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
	import { CommentViewStore, setCommentView } from '$lib/stores/comment-view.svelte';
	import {
		ConnectionNamesStore,
		connectionNamesData,
		setConnectionNames
	} from '$lib/stores/connection-names.svelte';
	import { FirstStepsStore, localStore, setFirstStepsStore } from '$lib/stores/first-steps.svelte';
	import {
		HouseholdStore,
		householdData,
		householdLive,
		setHouseholdStore,
		type HouseholdNotice
	} from '$lib/stores/household.svelte';
	import { recordScope, setClientArea } from '$lib/data/area';
	import type { ResolvedPathname } from '$app/types';
	import { AREA_TEXTS, areaSwitchTarget, recordOfRoute, type AreaView } from '$lib/domain/area';
	import type { HouseholdState } from '$lib/domain/household';
	import {
		AreaStore,
		setAreaStore,
		type AreaChangeCause,
		type AreaHousehold
	} from '$lib/stores/area.svelte';
	import { PeopleStore, peopleData, setPeople } from '$lib/stores/people.svelte';
	import { FolderViewer, folderViewData, setFolderViewer } from '$lib/stores/folder-view.svelte';
	import { fetchContext } from '$lib/data/context';
	import { fetchHostPlatform } from '$lib/data/host';
	import { appContext } from '$lib/stores/context.svelte';
	import { HostStore, setHostStore } from '$lib/stores/host.svelte';
	import { getNotifyStore } from '$lib/attention-notify.svelte';
	import { ackAttention } from '$lib/data/attention';
	import { fetchBackupAttention } from '$lib/data/backup';
	import { fetchSecurityNotice } from '$lib/data/security';
	import { AttentionStore, attentionSource } from '$lib/stores/attention.svelte';
	import { BackupAttention } from '$lib/stores/backup-attention';
	import { SecurityAttention } from '$lib/stores/security-attention';
	import { FlagStore, setFlagStore } from '$lib/stores/flags.svelte';
	import { getTabContext } from '$lib/tab-presence';
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
		TicketDuplicateStore,
		setTicketDuplicateStore,
		ticketDuplicateData
	} from '$lib/stores/ticket-duplicate.svelte';
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
	import { TicketOpenModeStore, setTicketOpenMode } from '$lib/stores/open-mode.svelte';
	import {
		TicketRowActionsStore,
		setTicketRowActions,
		ticketRowActionsData
	} from '$lib/stores/ticket-row-actions.svelte';
	import {
		RecentTicketsStore,
		setRecentTickets,
		setTicketPickerSource,
		ticketPickerData,
		ticketPickerSource
	} from '$lib/stores/ticket-picker.svelte';
	import { BulkEditStore, bulkEditData, setBulkEditStore } from '$lib/stores/bulk-edit.svelte';
	import { TrashStore, setTrashStore, trashData, trashLive } from '$lib/stores/trash.svelte';
	import { TrashAttention } from '$lib/stores/trash-attention';
	import { listTrash } from '$lib/data/trash';
	import { waitingCount } from '$lib/domain/trash';
	import { ticketHrefIn } from '$lib/ticket-host';
	import { inboxItemHref, recurrenceHref, recurrencesHref } from '$lib/ticket-links';

	// Shell of every signed-in page (E2 plan, T-4). The root layout renders it only with a
	// session; the login page stays outside this group.
	let { children } = $props();

	// The area of the tab (E7-3, ADR-0059): "Privat" or the household, remembered on this device per
	// account. It comes before every store, so the first loads already ask only for this area; a
	// change loads the stores of the area again without reloading the page.
	const area = setAreaStore(
		new AreaStore(
			localStore,
			(scope) => setClientArea(pb, scope),
			(cause) => areaChanged(cause)
		)
	);
	area.begin(auth.userId);
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
	// Panel or full view for every ticket link (plan BI-1, ADR-0036 §1), remembered on this device.
	const openMode = setTicketOpenMode(new TicketOpenModeStore(window));
	$effect(() => untrack(() => openMode.connect()));
	// Order of the comments on this device and the long ones unfolded in this tab (ADR-0044), the
	// same in panel and full view; other tabs follow the order through the storage event.
	const commentView = setCommentView(new CommentViewStore(window));
	$effect(() => untrack(() => commentView.connect()));
	// The last view outside the settings, for "Zurück zu …" there (ADR-0026 section 1, EH-1): every
	// shown address is offered, the store keeps only views (no settings, no full view).
	const lastView = setLastViewStore(new LastViewStore(sessionStore, () => page.url.origin));
	afterNavigate(({ to }) => {
		if (to) lastView.remember(to.url);
	});
	// Recurrence rules (E5 plan, T-7): all of them, for the table, the panel and the overview;
	// results of their actions go out as flags (package 5). They come first: a change of an open
	// ticket of a series in the panel, a cell or a bulk action offers the same for the template of
	// its rule (plan WV).
	const rules = setRecurrenceStore(new RecurrenceStore(recurrenceData(pb), auth, flags));
	// The column sort "Projekt" resolves projects through the catalog (E3 plan, package 9); the
	// "new" mark follows the own read rows and base line (E4 plan, package 4).
	const tickets = setTicketListStore(
		new TicketListStore(ticketListData(pb), auth, {
			projectOf: (ticket) => catalog.projectOf(ticket),
			// A project filter takes the sub projects in (ADR-0034).
			subProjectsOf: (projectId) => catalog.subProjectsOf(projectId).map((project) => project.id),
			reads: readsData(pb),
			flags,
			series: rules
		})
	);
	// Ticket picker (ADR-0042): every ticket choice lists the open tickets of the list store, the
	// recently viewed ones of this device first; done ones come page by page from the server.
	const recentTickets = setRecentTickets(new RecentTicketsStore(localStore, auth.userId));
	setTicketPickerSource(
		ticketPickerSource({
			data: ticketPickerData(pb),
			session: auth,
			list: tickets,
			catalog,
			recent: recentTickets
		})
	);
	// Trash (ADR-0037): its count for the navigation, the view "Papierkorb" and "Rückgängig" after
	// deleting a ticket; it reads the list again whenever the server reports a change.
	const trash = setTrashStore(
		new TrashStore(
			trashData(pb, () => auth.userId),
			auth,
			flags
		)
	);
	$effect(() => untrack(() => trash.start()));
	$effect(() => untrack(() => trash.connect(trashLive(pb))));
	// Replacing a pinned comment offers "Rückgängig" as a flag (ADR-0044).
	const detail = setTicketDetailStore(
		new TicketDetailStore(ticketDetailData(pb), auth, tickets, trash, rules, flags)
	);
	// "Ticket duplizieren" (ADR-0045): one request, the result as a flag with the way back.
	setTicketDuplicateStore(new TicketDuplicateStore(ticketDuplicateData(pb), auth, flags));
	// The menu "•••" of a row of the table (plan aktionsmenues, AM-2): its dialogs load what they
	// need first; moving to the trash offers "Rückgängig" like the panel.
	setTicketRowActions(
		new TicketRowActionsStore(ticketRowActionsData(pb), auth, tickets, trash, flags)
	);
	// Bulk actions on the chosen rows of the table (plan BI-2, ADR-0036 §3): one request per ticket
	// through the Record API, results and "Rückgängig" as flags.
	const bulk = setBulkEditStore(new BulkEditStore(bulkEditData(pb), auth, tickets, flags, rules));
	// The inbox (E4 plan, T-4): new entries in full, for the view and the count at the switch. The
	// filter "Zielprojekt" takes the sub projects of the catalog in (ADR-0049).
	const inbox = setInboxStore(new InboxStore(inboxData(pb), auth, flags, () => catalog.projects));
	const activity = setTicketActivityStore(
		new TicketActivityStore(ticketActivityData(pb), auth, () => auth.userId)
	);
	// Sources of the open ticket and the linking of inbox entries (ADR-0031): changed entries go
	// to the inbox at once, before their realtime event.
	const sources = setTicketSourcesStore(
		new TicketSourcesStore(ticketSourcesData(pb), auth, flags, (item) => inbox.upsert(item))
	);
	// "Ansehen" of a file of a watched folder (ADR-0051 §6): the panel of an entry and the sources of
	// a ticket open the current file through it.
	setFolderViewer(new FolderViewer(folderViewData(pb), auth));
	// Names of the connections for the inbox and the sources (ADR-0026, addendum KK-3): loaded once
	// per session, renames arrive through realtime.
	const connectionNames = setConnectionNames(
		new ConnectionNamesStore(connectionNamesData(pb), auth)
	);
	$effect(() => untrack(() => connectionNames.start()));
	// Names of the visible accounts for comments, history and the trash (ADR-0056 §4): loaded once
	// per session, new names arrive through realtime; without one a person stays "Anderes Konto".
	const people = setPeople(new PeopleStore(peopleData(pb), auth));
	$effect(() => untrack(() => people.start()));
	// The household of the account (ADR-0058): loaded once per session, read again on byl/household.
	// When the membership begins or ends (E7-3, ADR-0059 §8), no page reload: the stores show only
	// the area of the tab, so only what depends on the household loads again (the names of the
	// people, the area). Losing the household of the area leads to "Privat"; typed text stays.
	const household = setHouseholdStore(
		new HouseholdStore(householdData(pb), auth, flags, (notice) => membershipChanged(notice))
	);
	$effect(() => untrack(() => household.start()));
	$effect(() => untrack(() => household.connect(householdLive(pb))));

	/** The household of the account as the area needs it, null without one. */
	function areaHouseholdOf(state: HouseholdState | null): AreaHousehold | null {
		return state === null ? null : { id: state.household.id, name: state.household.name };
	}

	/** A link into an area that waits for the household of the account to be known. */
	let pendingScope: string | null = null;

	// The area follows the household as soon as it is known and whenever it changes (renamed, left,
	// removed); before the migration of the household there is none.
	$effect(() => {
		const state = household.state;
		const current = household.household;
		if (state !== 'ready' && state !== 'missing') return;
		untrack(() => {
			area.followHousehold(state === 'ready' ? areaHouseholdOf(current) : null);
			const waiting = pendingScope;
			pendingScope = null;
			if (waiting !== null) area.showScope(waiting);
		});
	});

	function membershipChanged(notice: HouseholdNotice) {
		const switched = area.followHousehold(areaHouseholdOf(household.household));
		void people.load();
		const text = [notice.text, switched ? AREA_TEXTS.lost : null].filter(Boolean).join(' ');
		flags.show({ tone: 'info', title: notice.title, ...(text !== '' && { description: text }) });
	}

	/**
	 * A change of the area (E7-3, ADR-0059 §2): the stores of the layout drop the old area at once and
	 * load the new one; the subscriptions follow by themselves (data/area.ts). By the switch or with
	 * the household gone, a record, form or filter of the old area closes; a link into the other area
	 * stays where it is and says so.
	 */
	function areaChanged(cause: AreaChangeCause) {
		catalog.rescope();
		tickets.rescope();
		rules.rescope();
		inbox.rescope();
		trash.rescope();
		if (cause === 'link') {
			flags.show({ tone: 'info', title: AREA_TEXTS.switched(area.name) });
			return;
		}
		const switched = areaSwitchTarget(page.url, page.route.id);
		if (switched === null) return;
		// A resolved view with the rest of its query, as svelte/no-navigation-without-resolve requires.
		const target = `${AREA_VIEW_HREFS[switched.view]}${switched.search}` as ResolvedPathname;
		const record = recordOfRoute(page.route.id, page.params.id);
		if (cause === 'switch' || record === null) {
			void goto(target);
			return;
		}
		// The household is gone: a record of it closes, one of the area that stays remains open.
		const shownUrl = page.url.href;
		void recordScope(pb, record.kind, record.id).then(
			(scope) => {
				if (scope !== area.key && page.url.href === shownUrl) void goto(target);
			},
			() => undefined
		);
	}

	/** The views a change of the area leads to. */
	const AREA_VIEW_HREFS: Readonly<Record<AreaView, ResolvedPathname>> = {
		tasks: resolve('/'),
		projects: resolve('/projekte'),
		inbox: resolve('/eingang'),
		recurrences: resolve('/wiederholungen'),
		calendar: resolve('/kalender'),
		trash: resolve('/papierkorb')
	};

	// Links into the other area (E7-3, ADR-0059 §7): a record opened by address, link, flag or the
	// calendar that belongs to the other area switches the area of the tab; one the account does not
	// see stays "nicht gefunden". The stores of the area are asked first, the server only otherwise.
	let followed = 0;
	async function followRecordArea(routeId: string | null, id: string | undefined) {
		const record = recordOfRoute(routeId, id);
		const mine = ++followed;
		if (record === null) return;
		const known =
			(record.kind === 'ticket' && tickets.find(record.id) !== null) ||
			(record.kind === 'project' && catalog.projectById(record.id) !== null) ||
			(record.kind === 'item' && inbox.find(record.id) !== null) ||
			(record.kind === 'rule' && rules.ruleById(record.id) !== null) ||
			(record.kind === 'trash' && trash.find(record.id) !== null);
		if (known) return;
		let scope: string | null;
		try {
			scope = await recordScope(pb, record.kind, record.id);
		} catch {
			// Not reachable: the panel says so itself.
			return;
		}
		if (scope === null || mine !== followed) return;
		if (household.state === 'ready') area.showScope(scope);
		else pendingScope = scope;
	}
	afterNavigate(() => void followRecordArea(page.route.id, page.params.id));
	$effect(() => untrack(() => rules.start()));
	$effect(() => untrack(() => rules.connect(recurrenceLive(pb))));
	// Rules that wait for the choice about a large backlog (ADR-0022 addendum 5) say so once the
	// rules are loaded, and again when the app is opened again (ADR-0035 section 5, below).
	const openWaiting = (ruleId: string | null) =>
		void goto(ruleId === null ? recurrencesHref() : recurrenceHref(ruleId));
	let waitingAnnounced = false;
	$effect(() => {
		if (rules.state !== 'ready' || waitingAnnounced) return;
		waitingAnnounced = true;
		untrack(() => rules.announceWaiting(openWaiting));
	});

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

	// Backups that need attention (ADR-0046, ADR-0035): one quiet flag after the sign-in and when the
	// app is opened again (below), only for a real warning.
	const backupAttention = new BackupAttention({
		check: () => fetchBackupAttention(pb),
		flags,
		open: () => void goto(resolve('/einstellungen/sicherung'))
	});
	// Tickets of the trash that wait for a decision (ADR-0047, ADR-0035): the same quiet flag.
	const trashAttention = new TrashAttention({
		waiting: async () => waitingCount((await listTrash(pb)).items),
		flags,
		open: () => void goto(resolve('/papierkorb'))
	});
	// Many failed sign-ins within a day (ADR-0055 §8, ADR-0035): the same quiet flag, once per
	// newest failure.
	const securityAttention = new SecurityAttention({
		check: () => fetchSecurityNotice(pb),
		flags,
		open: () => void goto(securityLoginsHref())
	});
	// Context of the tab (KOB-1, ADR-0057): who uses it from where. Loaded after the sign-in, every
	// refresh of the session and every reconnection (the restart after an update), back to the most
	// restrictive view when the layout goes.
	$effect(() =>
		untrack(() => appContext.start((signal) => fetchContext(pb, { signal }), pb.authStore, live))
	);
	const adminHere = $derived(appContext.capabilities.adminPages === 'full');
	// Backups and failed sign-ins are matters of the administrator of the app on its machine
	// (ADR-0056 §7, KOB-1): another account and another device do not ask the routes that would
	// refuse them. Asked once the context says so.
	const adminNotices = () => {
		if (!adminHere) return;
		void backupAttention.announce();
		void securityAttention.announce();
	};
	$effect(() => {
		if (auth.userId === null) return;
		untrack(() => void trashAttention.announce());
	});
	$effect(() => {
		if (auth.userId === null || !adminHere) return;
		untrack(() => adminNotices());
	});

	// Opened again (ADR-0035 section 5): start.bat, the landing page or stop.bat send a message on
	// byl/attention; this tab confirms it and shows a flag, the title blinks while it is hidden. A
	// second tab of this browser asks over the BroadcastChannel of the root layout.
	const tabContext = getTabContext();
	// The Windows notification is an opt-in of "Einstellungen → Darstellung" (SF-6).
	const notifyStore = getNotifyStore();
	const attention = new AttentionStore({
		ack: (nonce) => ackAttention(pb, nonce),
		flags,
		blink: () => tabContext?.blinker.start(),
		notify: () => void notifyStore.notify(),
		opened: () => {
			rules.announceWaiting(openWaiting);
			adminNotices();
			void trashAttention.announce();
		}
	});
	$effect(() => untrack(() => notifyStore.connect()));
	$effect(() => untrack(() => attention.connect(attentionSource(pb))));
	$effect(() => untrack(() => tabContext?.tabs.onAttention(() => attention.show('start'))));

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
	/** "Ticket ansehen" after the quick entry: in the view the user is in (ADR-0054 §8). */
	const capturedTicketHref = (id: string) =>
		ticketHrefIn(id, page.route.id, page.url, openMode.effective);

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

	// Operating system of the server (plan plattformen S0-3): the guides show a note above setx,
	// start.bat and stop.bat when the server does not run on Windows. Loaded once per sign-in.
	const host = setHostStore(new HostStore((signal) => fetchHostPlatform(pb, { signal })));
	$effect(() => {
		if (auth.userId === null) return;
		const controller = new AbortController();
		untrack(() => void host.load(controller.signal));
		return () => controller.abort();
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

<!-- In the household (E7-3, ADR-0059 §1) a line of the brand stays at the top of the window, also
     when the header scrolled away on a narrow screen; the switch in the header names the area. -->
{#if area.visible && area.active === 'household'}
	<div class="area-mark" aria-hidden="true"></div>
{/if}
<AppHeader
	covered={panelShell.covering}
	openCount={tickets.openState === 'ready' ? tickets.openCount : null}
	onquick={() => (quickOpen = true)}
	onshortcuts={() => (shortcutsOpen = true)}
	ontour={() => void startGuidedTour()}
/>
<main class="content">
	<!-- A failed realtime subscription is tried again; meanwhile a hint says so (ADR-0011 E6). -->
	<LiveUpdateNotice />
	<!-- A new build while this tab is open (ADR-0040): hint, and the next link loads it, unless
	     typed text of the ticket, a running bulk action or an offered "Rückgängig" would be lost. -->
	<AppUpdateNotice
		unsaved={() => detail.hasUnsavedInput || activity.dirty}
		pending={() => bulk.busy || flags.flags.some((flag) => flag.action !== null)}
	/>
	{@render children()}
</main>
<FlagGroup store={flags} />

{#if quickOpen}
	<QuickCapture
		projects={catalog.projects}
		tags={catalog.tags}
		onsave={(entry, target) => saveQuickEntry(entry, target, quickDeps)}
		onclose={() => (quickOpen = false)}
		resultHref={(target, id) => (target === 'ticket' ? capturedTicketHref(id) : inboxItemHref(id))}
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

	/* Marker of the household area: above the sticky header (5) and the panel (11), below flags. */
	.area-mark {
		position: fixed;
		inset: 0 0 auto;
		z-index: 12;
		height: 0.1875rem;
		pointer-events: none;
		background: var(--color-brand);
	}
</style>
