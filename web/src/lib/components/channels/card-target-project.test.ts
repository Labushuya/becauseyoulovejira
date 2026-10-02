// The setting "Zielprojekt" of the cards (ADR-0049, package 1; ADR-0026 addendum KK-2): in the
// details of every card that brings entries, reached from the menu "•••", saving at once; only
// active projects can be chosen, an archived target stays visible as such, a deleted one is named,
// a refusal stays at the field, and before the migration the row names the restart. The cards of a
// connection keep the target at the connection, the own inbox, WhatsApp Web and the files per
// user (InboxTargetsStore).

import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedPathname } from '$app/types';
import type { Connection } from '$lib/domain/connections';
import { EMPTY_TARGETS } from '$lib/domain/target-project';
import type { ProjectRef } from '$lib/domain/ticket';
import { FlagStore } from '$lib/stores/flags.svelte';
import { InboxKeysStore, type InboxKeysData } from '$lib/stores/inbox-keys.svelte';
import { InboxTargetsStore, type InboxTargetsData } from '$lib/stores/inbox-targets.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import ConnectionCard from './ConnectionCard.svelte';
import FilesCard from './FilesCard.svelte';
import OwnInboxCard from './OwnInboxCard.svelte';
import WhatsAppWebCard from './WhatsAppWebCard.svelte';

useOverlayStubs();

afterEach(() => {
	document.body.innerHTML = '';
});

const HAUS: ProjectRef = { id: 'haus00000000001', name: 'Haus', code: 'HAUS', archived: false };
const ALT: ProjectRef = { id: 'alt000000000001', name: 'Alt', code: 'ALT', archived: true };
const PROJECTS = [HAUS, ALT];

function connection(overrides: Partial<Connection> = {}): Connection {
	return {
		id: 'conn00000000001',
		type: 'calendar',
		label: 'Kalender',
		enabled: true,
		secretEnv: 'BYL_GOOGLE_CALENDAR_URL',
		allowlistEnv: '',
		lastRunAt: null,
		lastOkAt: null,
		lastError: '',
		lastHint: '',
		keywords: ['todo'],
		replySaved: true,
		replyNoMatch: true,
		mailProvider: '',
		mailUser: '',
		matchBody: false,
		runningSince: null,
		targetProjectId: null,
		targetReady: true,
		created: '2026-09-25 08:00:00.000Z',
		updated: '2026-09-25 08:00:00.000Z',
		...overrides
	};
}

function renderConnection(
	value: Connection,
	ontarget = vi.fn<(project: ProjectRef | null) => Promise<string | null>>(async () => null)
) {
	render(ConnectionCard, {
		props: {
			connection: value,
			secretStatus: { secret: true, allowlist: null },
			running: false,
			onrun: vi.fn(),
			onpick: vi.fn(),
			onedit: vi.fn(),
			onpause: vi.fn(),
			ondelete: vi.fn(),
			onsetup: vi.fn(),
			onreplies: vi.fn(async () => undefined),
			ontarget,
			projects: PROJECTS
		}
	});
	return { article: screen.getByRole('article', { name: value.label }), ontarget };
}

function menuOf(article: HTMLElement, name: string) {
	const trigger = within(article).getByRole('button', { name: `Weitere Aktionen für ${name}` });
	const menu = within(document.getElementById(trigger.getAttribute('aria-controls') ?? '')!);
	const items = () =>
		menu.getAllByRole('menuitem', { hidden: true }).map((item) => item.textContent?.trim());
	return { trigger, menu, items };
}

async function chooseTargetFromMenu(article: HTMLElement, name: string) {
	const { trigger, menu } = menuOf(article, name);
	await fireEvent.click(trigger);
	await fireEvent.click(menu.getByRole('menuitem', { name: 'Zielprojekt …', hidden: true }));
}

const selectOf = (article: HTMLElement, name: string) =>
	within(article).getByRole<HTMLSelectElement>('combobox', { name: `Zielprojekt von „${name}“` });

describe('card of a connection', () => {
	it('leads from the menu to the setting in the details and saves the choice at once', async () => {
		const { article, ontarget } = renderConnection(connection());
		const { items } = menuOf(article, 'Kalender');
		expect(items()).toContain('Zielprojekt …');
		expect(items().indexOf('Zielprojekt …')).toBe(
			items().indexOf('Stichwörter und Einstellungen …') + 1
		);

		await chooseTargetFromMenu(article, 'Kalender');
		const select = selectOf(article, 'Kalender');
		expect(select.closest('[hidden]')).toBeNull();
		expect(document.activeElement).toBe(select);
		// Only active projects; the hint says who gets it and when it counts.
		expect(
			within(select)
				.getAllByRole('option')
				.map((option) => option.textContent?.trim())
		).toEqual(['Kein Projekt', 'Haus (HAUS)']);
		expect(
			within(article).getByText(/^Neue Einträge dieser Verbindung bekommen dieses Projekt/)
		).toBeTruthy();

		await fireEvent.change(select, { target: { value: HAUS.id } });
		await waitFor(() => expect(ontarget).toHaveBeenCalledWith(HAUS));
		await fireEvent.change(select, { target: { value: '' } });
		await waitFor(() => expect(ontarget).toHaveBeenLastCalledWith(null));
	});

	it('keeps an archived target visible as such and says that converting does not take it', async () => {
		const { article } = renderConnection(connection({ targetProjectId: ALT.id }));
		await chooseTargetFromMenu(article, 'Kalender');
		const select = selectOf(article, 'Kalender');
		expect(select.value).toBe(ALT.id);
		expect(select.selectedOptions[0]?.textContent?.trim()).toBe('Alt (ALT, archiviert)');
		expect(within(article).getByText(/Das Zielprojekt ist archiviert/)).toBeTruthy();
	});

	it('shows a refusal of the server at the field, as an error', async () => {
		const { article } = renderConnection(
			connection(),
			vi.fn(async () => 'Ein archiviertes Projekt lässt sich nicht als Zielprojekt wählen.')
		);
		await chooseTargetFromMenu(article, 'Kalender');
		const select = selectOf(article, 'Kalender');
		await fireEvent.change(select, { target: { value: HAUS.id } });
		const error = await within(article).findByText(
			'Ein archiviertes Projekt lässt sich nicht als Zielprojekt wählen.'
		);
		expect(select.getAttribute('aria-invalid')).toBe('true');
		expect(select.getAttribute('aria-describedby')).toContain(error.parentElement?.id ?? 'x');
	});

	it('names the restart before the migration and offers no menu entry', async () => {
		const { article } = renderConnection(connection({ targetReady: false }));
		expect(menuOf(article, 'Kalender').items()).not.toContain('Zielprojekt …');
		await fireEvent.click(within(article).getByRole('button', { name: 'Details: Kalender' }));
		expect(
			within(article).getByText(/Das Zielprojekt ist nach dem nächsten Neustart verfügbar/)
		).toBeTruthy();
		expect(within(article).queryByRole('combobox')).toBeNull();
	});
});

function targetsStore(initial = EMPTY_TARGETS) {
	const data = {
		load: vi.fn<InboxTargetsData['load']>(async () => initial),
		save: vi.fn<InboxTargetsData['save']>(async (targets) => targets)
	} satisfies InboxTargetsData;
	const flags = new FlagStore();
	const store = new InboxTargetsStore(data, { ensureValid: () => true, logout: vi.fn() }, flags);
	return { data, store, flags };
}

describe('cards without a connection', () => {
	it('keeps the target of the files per user and names a deleted one', async () => {
		const { data, store, flags } = targetsStore({
			...EMPTY_TARGETS,
			files: 'weg000000000001'
		});
		await store.load();
		render(FilesCard, { props: { inboxTargets: store, projects: PROJECTS } });
		const article = screen.getByRole('article', { name: 'Dateien hereinziehen' });
		await chooseTargetFromMenu(article, 'Dateien hereinziehen');
		expect(within(article).getByText(/Das gewählte Zielprojekt gibt es nicht mehr/)).toBeTruthy();
		await fireEvent.change(selectOf(article, 'Dateien hereinziehen'), {
			target: { value: HAUS.id }
		});
		await waitFor(() =>
			expect(data.save).toHaveBeenCalledWith({ api: '', 'whatsapp-web': '', files: HAUS.id })
		);
		expect(flags.flags[0]?.title).toBe(
			'Neue Einträge von „Dateien hereinziehen“ bekommen jetzt das Zielprojekt „Haus (HAUS)“.'
		);
	});

	it('gives the own inbox and WhatsApp Web a target each', async () => {
		const { data, store } = targetsStore();
		await store.load();
		const keys = {
			list: vi.fn<InboxKeysData['list']>(async () => []),
			create: vi.fn<InboxKeysData['create']>(),
			revoke: vi.fn<InboxKeysData['revoke']>()
		} satisfies InboxKeysData;
		const inboxKeys = new InboxKeysStore(keys, { ensureValid: () => true, logout: vi.fn() });
		await inboxKeys.load();
		render(OwnInboxCard, { props: { store: inboxKeys, inboxTargets: store, projects: PROJECTS } });
		render(WhatsAppWebCard, {
			props: {
				inboxKeys,
				inboxTargets: store,
				projects: PROJECTS,
				setupHref: '/einstellungen/kanaele?einrichten=whatsapp-web' as ResolvedPathname
			}
		});

		const own = screen.getByRole('article', { name: 'Eigener Eingang (API)' });
		await chooseTargetFromMenu(own, 'Eigener Eingang (API)');
		await fireEvent.change(selectOf(own, 'Eigener Eingang (API)'), { target: { value: HAUS.id } });
		await waitFor(() =>
			expect(data.save).toHaveBeenLastCalledWith({ ...EMPTY_TARGETS, api: HAUS.id })
		);

		const chat = screen.getByRole('article', { name: 'WhatsApp Web (Browser-Erweiterung)' });
		await chooseTargetFromMenu(chat, 'WhatsApp Web (Browser-Erweiterung)');
		expect(within(chat).getByText(/^Neue Einträge aus WhatsApp Web bekommen/)).toBeTruthy();
		await fireEvent.change(selectOf(chat, 'WhatsApp Web (Browser-Erweiterung)'), {
			target: { value: HAUS.id }
		});
		await waitFor(() =>
			expect(data.save).toHaveBeenLastCalledWith({
				...EMPTY_TARGETS,
				api: HAUS.id,
				'whatsapp-web': HAUS.id
			})
		);
	});

	it('names the restart before the migration and hides the menu entry', async () => {
		const data = {
			load: vi.fn<InboxTargetsData['load']>(async () => null),
			save: vi.fn<InboxTargetsData['save']>()
		} satisfies InboxTargetsData;
		const store = new InboxTargetsStore(data, { ensureValid: () => true, logout: vi.fn() });
		await store.load();
		expect(store.state).toBe('unavailable');
		render(FilesCard, { props: { inboxTargets: store, projects: PROJECTS } });
		const article = screen.getByRole('article', { name: 'Dateien hereinziehen' });
		expect(menuOf(article, 'Dateien hereinziehen').items()).not.toContain('Zielprojekt …');
		await fireEvent.click(
			within(article).getByRole('button', { name: 'Details: Dateien hereinziehen' })
		);
		expect(within(article).getByText(/nach dem nächsten Neustart verfügbar/)).toBeTruthy();
	});
});
