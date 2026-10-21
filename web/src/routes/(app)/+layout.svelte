<script lang="ts">
	import { untrack } from 'svelte';
	import { afterNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { auth } from '$lib/auth.svelte';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import AppUpdateNotice from '$lib/components/AppUpdateNotice.svelte';
	import AreaMoveDialog from '$lib/components/AreaMoveDialog.svelte';
	import LiveUpdateNotice from '$lib/components/LiveUpdateNotice.svelte';
	import ShortcutsModal from '$lib/components/help/ShortcutsModal.svelte';
	import OfflineNotice from '$lib/components/offline/OfflineNotice.svelte';
	import OutboxButton from '$lib/components/offline/OutboxButton.svelte';
	import OutboxDialog from '$lib/components/offline/OutboxDialog.svelte';
	import ConfirmDialog from '$lib/components/overlay/ConfirmDialog.svelte';
	import FlagGroup from '$lib/components/overlay/FlagGroup.svelte';
	import PhoneTabBar from '$lib/components/phone/PhoneTabBar.svelte';
	import PhoneTopBar from '$lib/components/phone/PhoneTopBar.svelte';
	import QuickCapture from '$lib/components/QuickCapture.svelte';
	import { isHelpKey, isQuickCaptureKey, isTypingTarget } from '$lib/domain/keyboard';
	import { isPhoneStart, warnsBeforeLeaving } from '$lib/domain/phone-layout';
	import { getMobileLayoutStore } from '$lib/mobile-layout.svelte';
	import { pb } from '$lib/pocketbase';
	import { setQuickCaptureOpener } from '$lib/quick-capture-context';
	import { securityLoginsHref } from '$lib/settings-sections';
	import { startTour } from '$lib/tour/tour';
	import { setTourStarter } from '$lib/tour/tour-context';
	import {
		panelFreeTicketCreate,
		quickItemCreate,
		quickTicketData,
		saveQuickEntry,
		type CaptureDeps
	} from '$lib/stores/capture';
	import { CatalogStore, catalogData, setCatalogStore } from '$lib/stores/catalog.svelte';
	import { ColumnPrefsRegistry, setColumnPrefsRegistry } from '$lib/stores/column-prefs.svelte';
	import { CommentViewStore, setCommentView } from '$lib/stores/comment-view.svelte';
	import { setSourceOrder, sourceOrderStore } from '$lib/stores/list-order.svelte';
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
	import {
		AreaMoveStore,
		areaMoveData,
		dropMovedTickets,
		setAreaMoveStore
	} from '$lib/stores/area-move.svelte';
	import type { MovePreview } from '$lib/domain/area-move';
	import { PeopleStore, peopleData, setPeople } from '$lib/stores/people.svelte';
	import { AssigneeDirectory, setAssignees } from '$lib/stores/assignees.svelte';
	import {
		AssignedNotices,
		assignedLive,
		type AssignedNotice
	} from '$lib/stores/assigned-notices.svelte';
	import { PinStore, pinData, setPinStore } from '$lib/stores/pins.svelte';
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
		SubtaskTransferStore,
		setSubtaskTransferStore,
		subtaskTransferData
	} from '$lib/stores/subtask-transfer.svelte';
	import {
		TransferOfferStore,
		setTransferOfferStore
	} from '$lib/stores/subtask-transfer-offer.svelte';
	import {
		TicketFollowUpStore,
		setTicketFollowUpStore,
		ticketFollowUpData
	} from '$lib/stores/ticket-follow-up.svelte';
	import {
		TicketOriginsStore,
		setTicketOriginsStore,
		ticketOriginsData
	} from '$lib/stores/ticket-origins.svelte';
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
	import {
		DayPlanEntryStore,
		dayPlanEntryData,
		setDayPlanEntryStore
	} from '$lib/stores/day-plan.svelte';
	import { ticketHrefIn } from '$lib/ticket-host';
	import { dayPlanHref, inboxItemHref, recurrenceHref, recurrencesHref } from '$lib/ticket-links';
	import { hasUnsavedInput, registerUnsavedInput } from '$lib/unsaved-input';
	import { WayBack, setWayBack } from '$lib/way-back';
	import { listHistory } from '$lib/data/history';
	import { OFFLINE_TEXTS, isDueAction, ticketOf, type KeptAction } from '$lib/domain/offline';
	import { personLabel } from '$lib/domain/people';
	import type { TicketChangeSink } from '$lib/domain/subtask-transfer-change';
	import type { Ticket, TicketSummary } from '$lib/domain/ticket';
	import type { InboxItemSummary } from '$lib/domain/inbox';
	import { forgetOfflineSupport, getOutbox, offlineSupport } from '$lib/offline/app-outbox';
	import { offlineTicketDetailData, offlineTicketListData } from '$lib/offline/offline-data';
	import { setOutboxContext } from '$lib/offline/outbox.svelte';
	import { preloadOfflineViews } from '$lib/offline/preload';
	import { setSignOut } from '$lib/sign-out';

	// Shell of every signed-in page (E2 plan, T-4). The root layout renders it only with a
	// session; the login page stays outside this group.
	let { children } = $props();

	// Phone frame (MO-1a, ADR-0073): with the switch "Handy-Ansicht (Vorschau)" of this device on and
	// below 40rem the compact top bar and the bottom bar take the place of the header, and the app
	// starts with the day plan. The switch is off by default; off, or wider, nothing changes. The
	// store follows the width and other tabs and keeps the meta viewport in line while shown.
	const mobileLayout = getMobileLayoutStore();
	$effect(() => untrack(() => mobileLayout.connect()));
	const phone = $derived(mobileLayout.active);
	// The start view on the phone is the day plan (decision of the user): only when the app opens at
	// its bare start page, never for a link with its own address, a reload or a tap on "Aufgaben".
	let started = false;
	afterNavigate(() => {
		if (started) return;
		started = true;
		const kind = (performance.getEntriesByType?.('navigation')[0] as { type?: unknown } | undefined)
			?.type;
		const start = isPhoneStart({
			pathname: page.url.pathname,
			search: page.url.search,
			hash: page.url.hash,
			referrer: document.referrer,
			origin: page.url.origin,
			navigation: typeof kind === 'string' ? kind : ''
		});
		if (mobileLayout.active && start) void goto(dayPlanHref(), { replaceState: true });
	});
	// Leaving the page in the phone frame (MO-1b): reloading, pulling down to refresh, closing the
	// tab or a link out of the app asks the browser's question first while typed input is not saved
	// (quick entry, comment, a field of the ticket, a form; lib/unsaved-input.ts). Only while the
	// frame applies; on the PC no listener, nothing changes.
	$effect(() => {
		if (!phone) return;
		const onbeforeunload = (event: BeforeUnloadEvent) => {
			if (warnsBeforeLeaving(mobileLayout.active, hasUnsavedInput())) event.preventDefault();
		};
		window.addEventListener('beforeunload', onbeforeunload);
		return () => window.removeEventListener('beforeunload', onbeforeunload);
	});

	// The outbox (OF-2, ADR-0074 addenda OF-2 and OF-3): while the server reports `offline_ops` and the
	// phone frame applies, a check mark, a status, a due date or a check mark of the day plan that does
	// not reach the server is kept on this device and sent later over the normal way (the day plan
	// binds its shell in its own layout). Without either, every change goes as before. It belongs to
	// the signed-in account; the layout tells it the account, the frame and the answer of the server,
	// and shows its hints, its symbol, its dialog and its questions.
	const outbox = getOutbox();
	setOutboxContext(outbox);
	$effect(() => {
		const active = phone;
		untrack(() => outbox.setFrame(active));
	});
	$effect(() => {
		const user = auth.userId ?? null;
		untrack(() => outbox.attach(user));
	});
	// Whether the server takes the outbox: asked once per sign-in with the question of "Neues Ticket",
	// again when the tab comes back while it did not (a restart of the server meanwhile), at most
	// every 5 minutes (OF-2b, `offlineSupport`).
	$effect(() => {
		if (!auth.userId) return;
		const ask = () => {
			if (!auth.ensureValid()) return;
			void offlineSupport().then((ops) => outbox.setSupport(ops));
		};
		untrack(ask);
		const onvisible = () => {
			if (document.visibilityState === 'visible' && !outbox.supported) ask();
		};
		document.addEventListener('visibilitychange', onvisible);
		return () => {
			document.removeEventListener('visibilitychange', onvisible);
			forgetOfflineSupport();
		};
	});
	// Reloading without a connection would leave the app unopenable until the server is back: the
	// browser asks first while changes are kept (only in the frame, the listener above).
	$effect(() => registerUnsavedInput(() => outbox.reloadRisky));
	// The modules of the views of the outbox, once it works and the server answers.
	let preloaded = false;
	$effect(() => {
		if (preloaded || !outbox.armed || outbox.offline) return;
		preloaded = true;
		untrack(() => preloadOfflineViews());
	});
	let outboxOpen = $state(false);
	/** The question before reloading without a connection, with what to run on "Neu laden". */
	let reloadQuestion = $state<{ run: () => void } | null>(null);
	function guardedReload(run: () => void) {
		if (outbox.reloadRisky) reloadQuestion = { run };
		else run();
	}
	function confirmReload() {
		const question = reloadQuestion;
		reloadQuestion = null;
		question?.run();
	}
	/** The question before signing out with kept changes (decision of the user 4). */
	let logoutQuestion = $state<{ target: ResolvedPathname; count: number } | null>(null);
	let loggingOut = $state(false);
	async function leave(target: ResolvedPathname) {
		auth.logout();
		await goto(target, { replaceState: true });
	}
	function askBeforeLeaving(target: ResolvedPathname, count: number) {
		if (count > 0) logoutQuestion = { target, count };
		else void leave(target);
	}
	// A tab that never read the device (the server without `offline_ops`, outside of the frame)
	// reads the changes of the account there first, so "Abmelden" asks and deletes them as well
	// (OF-2b). Without a database nothing is created; a failing read signs out, the changes stay.
	setSignOut((target) => {
		if (!outbox.readsOnSignOut) {
			askBeforeLeaving(target, outbox.count);
			return;
		}
		void outbox.keptOfAccount().then(
			(count) => askBeforeLeaving(target, count),
			() => void leave(target)
		);
	});
	async function confirmLogout() {
		const question = logoutQuestion;
		if (question === null || loggingOut) return;
		loggingOut = true;
		try {
			await outbox.clearUser();
		} catch {
			// The device keeps them; they belong to this account and wait for its next sign-in.
		}
		loggingOut = false;
		logoutQuestion = null;
		await leave(question.target);
	}
	/**
	 * Who changed the field of a conflicted ticket meanwhile (the status, since OF-3 also the due
	 * date), from its history; null for oneself.
	 */
	async function changedBy(action: KeptAction): Promise<string | null> {
		const field = isDueAction(action) ? 'due' : 'status';
		const entries = await listHistory(pb, ticketOf(action));
		const entry = entries.find((candidate) => candidate.field === field);
		if (entry === undefined || entry.user === auth.userId) return null;
		return personLabel(entry.user, auth.userId, people);
	}

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
	// Order of the sources, source tickets and follow-ups on this device (QS-1, ADR-0031 addendum
	// M), the same in panel and full view; other tabs follow through the storage event.
	const sourceOrder = setSourceOrder(sourceOrderStore(window));
	$effect(() => untrack(() => sourceOrder.connect()));
	// The last view outside the settings, for "Zurück zu …" there (ADR-0026 section 1, EH-1): every
	// shown address is offered, the store keeps only views (no settings, no full view).
	const lastView = setLastViewStore(new LastViewStore(sessionStore, () => page.url.origin));
	afterNavigate(({ to }) => {
		if (to) lastView.remember(to.url);
	});
	// The entry of the history before the page (MO-4, ADR-0073 addendum MO-4): the arrow of a panel
	// shown as a page in the phone frame goes back through the history when it holds the view.
	const wayBack = setWayBack(new WayBack());
	afterNavigate(({ type, from, delta }) =>
		wayBack.arrived({ type, from: from?.url ?? null, delta })
	);
	// Recurrence rules (E5 plan, T-7): all of them, for the table, the panel and the overview;
	// results of their actions go out as flags (package 5). They come first: a change of an open
	// ticket of a series in the panel, a cell or a bulk action offers the same for the template of
	// its rule (plan WV).
	const rules = setRecurrenceStore(new RecurrenceStore(recurrenceData(pb), auth, flags));
	// "Übertragen …" after a change of a ticket with open sub-tasks (UE-2, ADR-0070 addendum UE-2):
	// panel, full view, cells, check mark and calendar report their changes here; it shows the flag
	// or leaves the change to the offer of the series of the rules. Its action opens the ticket where
	// it is not shown (like "Öffnen" of other flags), and its section "Unteraufgaben" the dialog.
	const transferOffers = setTransferOfferStore(
		new TransferOfferStore({
			flags,
			subtasksOf: (id) => tickets.subtasksOf(id),
			series: rules,
			support: () => subtaskTransfer.support,
			reveal: async (id) => {
				if (detail.id !== id) {
					await goto(ticketHrefIn(id, page.route.id, page.url, openMode.effective));
				}
			}
		})
	);
	afterNavigate(() => transferOffers.navigated());
	// A change the outbox keeps for later offers nothing yet: "Übertragen …" and the offer of the
	// series need the server (OF-2); once sent, the stores report changes as before.
	const changeOffers: TicketChangeSink = {
		changed: (change) => {
			if (!outbox.isPending(change.after.id)) transferOffers.changed(change);
		}
	};
	// The own pinned tickets (ADR-0064) of every area, live in every tab of the account; they come
	// before the list, which shows them in the section "Angeheftet" instead of below.
	const pins = setPinStore(new PinStore(pinData(pb), auth, flags));
	$effect(() => untrack(() => pins.start()));
	// "Zuständig" (E7-5, ADR-0068): the members of the household and the names of the accounts for the
	// field, the initials, the card "Mir zugewiesen", the groups and the sort. It reads the area, the
	// household and the people once they exist (connected below).
	const assigneeDirectory = new AssigneeDirectory(auth);
	setAssignees(assigneeDirectory);
	// The column sort "Projekt" resolves projects through the catalog (E3 plan, package 9); the
	// "new" mark follows the own read rows and base line (E4 plan, package 4).
	// The check mark, the status and the due date of a cell go through the outbox while it works
	// (OF-2, OF-3).
	const blockingIds = (id: string) => tickets.openBlockingOf(id).map((child) => child.id);
	const tickets = setTicketListStore(
		new TicketListStore(
			offlineTicketListData(ticketListData(pb), outbox, (id) => tickets.find(id), blockingIds),
			auth,
			{
				projectOf: (ticket) => catalog.projectOf(ticket),
				// A project filter takes the sub projects in (ADR-0034).
				subProjectsOf: (projectId) => catalog.subProjectsOf(projectId).map((project) => project.id),
				reads: readsData(pb),
				flags,
				series: rules,
				changes: changeOffers,
				pins,
				assignees: () => assigneeDirectory.context,
				overlay: outbox
			}
		)
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
	// The status and the due date of the panel and the full view go through the outbox while it works
	// (OF-2, OF-3).
	const detail = setTicketDetailStore(
		new TicketDetailStore(
			offlineTicketDetailData(
				ticketDetailData(pb),
				outbox,
				(id) => (detail.ticket?.id === id ? detail.ticket : null),
				blockingIds
			),
			auth,
			tickets,
			trash,
			rules,
			flags,
			changeOffers,
			outbox
		)
	);
	// The outbox shows what the server answered later in the list and the panel.
	function showFromOutbox(ticket: TicketSummary) {
		tickets.upsert(ticket);
		const shown = detail.ticket;
		if (shown?.id !== ticket.id) return;
		if ('description' in ticket) detail.upsert(ticket as Ticket);
		else detail.upsert({ ...shown, ...ticket, description: shown.description });
	}
	const outboxSink = {
		upsert: showFromOutbox,
		flags,
		sessionEnded: () => auth.logout(),
		childrenOf: blockingIds,
		// "＋" kept for later (OF-4a): the entry of the server joins the inbox, and a ticket created one
		// by one counts as read once it arrived (ADR-0015 §3).
		upsertItem: (item: InboxItemSummary) => inbox.upsert(item),
		markRead: (ticket: Ticket) => void tickets.markRead(ticket)
	};
	$effect(() => untrack(() => outbox.connect(outboxSink)));
	// "Ticket duplizieren" (ADR-0045): one request, the result as a flag with the way back. Whether the
	// server takes the status of the new sub-tasks comes from the same answer as "Neues Ticket" (UT-2).
	setTicketDuplicateStore(new TicketDuplicateStore(ticketDuplicateData(pb), auth, flags, detail));
	// "Auf Unteraufgaben übertragen …" (ADR-0070): one request, the result as a flag; the device keeps
	// the last confirmed fields. Whether the server knows the route comes from the same answer.
	const subtaskTransfer = setSubtaskTransferStore(
		new SubtaskTransferStore(subtaskTransferData(pb), auth, flags, detail, window)
	);
	// "Zum Tagesplan" in the menu "•••" of every ticket (ADR-0065): into the plan of today of its own
	// area; the flag leads to the plan.
	setDayPlanEntryStore(
		new DayPlanEntryStore(dayPlanEntryData(pb), auth, flags, () => void goto(dayPlanHref()))
	);
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
	// Entries "＋" put into the inbox without a connection show from the outbox until the server has
	// them (OF-4a).
	const inbox = setInboxStore(
		new InboxStore(inboxData(pb), auth, flags, () => catalog.projects, outbox)
	);
	const activity = setTicketActivityStore(
		new TicketActivityStore(ticketActivityData(pb), auth, () => auth.userId)
	);
	// Sources of the open ticket and the linking of inbox entries (ADR-0031): changed entries go
	// to the inbox at once, before their realtime event.
	const sources = setTicketSourcesStore(
		new TicketSourcesStore(ticketSourcesData(pb), auth, flags, (item) => inbox.upsert(item))
	);
	// Tickets as sources of the open ticket and its follow-ups (ADR-0067), live; "Folge-Ticket
	// anlegen …" in the menus "•••" of tickets and rows.
	setTicketOriginsStore(new TicketOriginsStore(ticketOriginsData(pb), auth, flags));
	setTicketFollowUpStore(new TicketFollowUpStore(ticketFollowUpData(pb), auth, flags));
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
	assigneeDirectory.connect({ area, household, people });
	// "Anna hat dir HAUS-12 zugewiesen." (ADR-0068 §4): a live notice when another member gives this
	// account a ticket, with the way to it.
	const assignedNotices = new AssignedNotices(flags, (notice) => openAssigned(notice));
	$effect(() => untrack(() => assignedNotices.connect(assignedLive(pb))));

	/** The way to an assigned ticket: in the view of the tab; a link into the other area switches it (E7-3). */
	function openAssigned(notice: AssignedNotice) {
		void goto(ticketHrefIn(notice.ticket, page.route.id, page.url, openMode.effective));
	}

	// Moving between the areas (E7-4, ADR-0061): one dialog for every menu and the bulk action. The
	// moved tickets leave the list at once (their realtime "delete" follows); a tab that shows a moved
	// record follows it into its area, like a link into the other area.
	const areaMove = setAreaMoveStore(
		new AreaMoveStore(areaMoveData(pb), auth, flags, (result) => followMove(result))
	);

	function followMove(result: MovePreview) {
		const moved = result.moved;
		if (moved === null) return;
		dropMovedTickets(tickets, result);
		const record = recordOfRoute(page.route.id, page.params.id);
		if (record === null) return;
		const ids: Readonly<Record<string, readonly string[]>> = {
			ticket: moved.tickets.map((ticket) => ticket.id),
			project: moved.projects.map((project) => project.id),
			rule: moved.rules,
			item: moved.items
		};
		if ((ids[record.kind] ?? []).includes(record.id)) area.showScope(result.scope);
	}

	// A ticket shown in a panel or full view that another tab moved into an area this account sees
	// (E7-4): the tab follows it there; one it no longer sees closes with its notice (TicketPanel).
	$effect(() => {
		const shown = detail.state === 'ready' ? detail.ticket : null;
		const scope = shown?.scope;
		if (shown === null || scope === undefined || scope === area.key) return;
		untrack(() => {
			const record = recordOfRoute(page.route.id, page.params.id);
			if (record?.kind === 'ticket' && record.id === shown.id) area.showScope(scope);
		});
	});

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
		transferOffers.reset();
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
		dayplan: resolve('/tagesplan'),
		projects: resolve('/projekte'),
		inbox: resolve('/eingang'),
		recurrences: resolve('/wiederholungen'),
		calendar: resolve('/kalender'),
		done: resolve('/erledigt'),
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
	// Without a connection "＋" keeps the line in the outbox where it works (OF-4a, ADR-0074 addendum
	// OF-4a): as a ticket or into the inbox, under an ID of the client; new #tags need the server.
	const quickDeps: CaptureDeps = {
		ensureTag: (name) => catalog.ensureTag(name),
		createTicket: panelFreeTicketCreate(quickTicketData(pb), auth, tickets, outbox),
		createItem: quickItemCreate((draft) => inbox.create(draft), outbox, auth, inbox),
		markRead: (ticket) => tickets.markRead(ticket),
		keep: {
			takes: (target) => outbox.takes(target === 'ticket' ? 'ticket' : 'inbox'),
			offline: () => outbox.offline
		}
	};
	// Empty states offer "Schnellerfassung (c)" through the context (plan EH-11).
	setQuickCaptureOpener(() => (quickOpen = true));
	/** "Ticket ansehen" after the quick entry: in the view the user is in (ADR-0054 §8). */
	const capturedTicketHref = (id: string) =>
		ticketHrefIn(id, page.route.id, page.url, openMode.effective);
	/** A record a notice of the outbox names (OF-4a): the ticket in the view, or the entry. */
	const recordHref = (record: 'ticket' | 'inbox', id: string) =>
		record === 'ticket' ? capturedTicketHref(id) : inboxItemHref(id);

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
		// Not in the phone frame (MO-1a): its steps point at the header and the filter bar of the PC.
		if (touring || mobileLayout.active) return;
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
{#if phone}
	<PhoneTopBar covered={panelShell.covering}>
		{#snippet status()}
			<OutboxButton {outbox} onshow={() => (outboxOpen = true)} />
		{/snippet}
	</PhoneTopBar>
{:else}
	<AppHeader
		covered={panelShell.covering}
		openCount={tickets.openState === 'ready' ? tickets.openCount : null}
		onquick={() => (quickOpen = true)}
		onshortcuts={() => (shortcutsOpen = true)}
		ontour={() => void startGuidedTour()}
	/>
{/if}
<!-- No tabindex of its own: where the hints of the outbox go with their last notice and the view has no
     heading, OfflineNotice gives it one only until the focus leaves it (OF-3c round 3, C2-1). -->
<main class="content">
	<!-- The outbox (OF-2): without a connection its warning takes the place of the live hint; kept
	     changes, conflicts and refusals with "Ansehen". Only while it works, keeps something or has a
	     notice that stays until it is closed (OF-3b round 3). -->
	{#if outbox.watching || outbox.count > 0 || outbox.notices.length > 0}
		<OfflineNotice {outbox} onshow={() => (outboxOpen = true)} linkOf={recordHref} />
	{/if}
	<!-- A failed realtime subscription is tried again; meanwhile a hint says so (ADR-0011 E6). -->
	{#if !outbox.offline}
		<LiveUpdateNotice reload={() => guardedReload(() => window.location.reload())} />
	{/if}
	<!-- A new build while this tab is open (ADR-0040): hint, and the next link loads it, unless
	     typed text of the ticket, a running bulk action or an offered "Rückgängig" would be lost,
	     or the connection is missing (OF-2: a new document would not load). -->
	<AppUpdateNotice
		unsaved={() => detail.hasUnsavedInput || activity.dirty}
		pending={() => bulk.busy || flags.flags.some((flag) => flag.action !== null) || outbox.offline}
		reload={() => guardedReload(() => window.location.reload())}
	/>
	{@render children()}
</main>
{#if phone}
	<!-- After the page and outside the top bar, whose glass must hold no fixed descendant. -->
	<PhoneTabBar
		covered={panelShell.covering}
		inboxCount={inbox.newCount}
		projectsNewCount={tickets.newInProjects}
		onquick={() => (quickOpen = true)}
	/>
{/if}
<!-- The flags after the page; while a modal is open they show in the topmost one instead, in front
     of it and clickable (ADR-0025 §8, addendum 18, FL-1). -->
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

{#if areaMove.request !== null && areaMove.request.inline !== true}
	<AreaMoveDialog store={areaMove} />
{/if}

{#if outboxOpen}
	<OutboxDialog
		{outbox}
		onclose={() => (outboxOpen = false)}
		ticketHref={(id) => ticketHrefIn(id, page.route.id, page.url, openMode.effective)}
		itemHref={(id) => inboxItemHref(id)}
		{changedBy}
	/>
{/if}

<!-- Questions of the outbox (OF-2): before reloading without a connection, before signing out with
     kept changes; "Abbrechen" has the first focus. -->
{#if reloadQuestion !== null}
	<ConfirmDialog
		open
		title={OFFLINE_TEXTS.reloadTitle}
		confirmLabel={OFFLINE_TEXTS.reloadConfirm}
		onconfirm={confirmReload}
		oncancel={() => (reloadQuestion = null)}
	>
		{OFFLINE_TEXTS.reloadText(outbox.count)}
	</ConfirmDialog>
{/if}

{#if logoutQuestion !== null}
	<ConfirmDialog
		open
		title={OFFLINE_TEXTS.logoutTitle(logoutQuestion.count)}
		confirmLabel={OFFLINE_TEXTS.logoutConfirm}
		busy={loggingOut}
		onconfirm={() => void confirmLogout()}
		oncancel={() => (logoutQuestion = null)}
	>
		{OFFLINE_TEXTS.logoutText(logoutQuestion.count)}
	</ConfirmDialog>
{/if}

<style>
	/* The embedded side panel reaches over this padding to the edges of the window (UI-6b). */
	.content {
		--content-padding: var(--page-inline);
		padding: var(--content-padding);
	}

	/* Phone frame (MO-1a, ADR-0073): the end of the page stays above the bottom bar. */
	@media (max-width: 39.99rem) {
		:global(:root[data-mobile-layout='on']) .content {
			padding-bottom: calc(var(--content-padding) + var(--bottom-bar-height) + var(--safe-bottom));
		}
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
