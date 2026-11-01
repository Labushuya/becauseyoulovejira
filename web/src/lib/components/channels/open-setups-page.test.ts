// Open setups on the page "Kanäle" (KE-1, ADR-0076): the overview above the cards with its links,
// the focus and the text for screen readers, "am PC fortsetzen" on another device in the phone
// frame, the hand-over to the store of the layout (the mark at "Kanäle"), "Erste Schritte" only for
// a done setup (E4) and the tile "Begonnen · Fortsetzen" of an assistant begun before its
// connection (E3). Data layers are fakes; stores and building blocks are real.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection } from '$lib/domain/connections';
import type { InboxKey } from '$lib/domain/inbox-keys';
import { serializeSetupResume } from '$lib/domain/setup-resume';
import { FirstStepsStore } from '$lib/stores/first-steps.svelte';
import { InboxKeysStore, type InboxKeysData } from '$lib/stores/inbox-keys.svelte';
import { OpenSetupsStore, type OpenSetupsData } from '$lib/stores/open-setups.svelte';
import ChannelsViewHarness from '$lib/test/ChannelsViewHarness.svelte';
import { connectionOf, connectionsStoreOf, fakeConnectionsData } from '$lib/test/connections-fake';
import { PC_CONTEXT, REMOTE_CONTEXT, useContext } from '$lib/test/context';
import { credentialsStoreOf, fakeCredentialsData, variableOf } from '$lib/test/credentials-fake';
import { useOverlayStubs } from '$lib/test/overlay-stubs';

useOverlayStubs();

const OK = '2026-11-01 08:00:00.000Z';

/** Never ran: "Erster Abruf" is open. */
const CALENDAR = connectionOf({
	id: 'conn00000000021',
	label: 'Google Kalender',
	keywords: ['todo']
});
/** Set up and run: done. */
const DONE = connectionOf({
	id: 'conn00000000022',
	label: 'Familie',
	keywords: ['todo'],
	lastRunAt: OK,
	lastOkAt: OK,
	created: '2026-10-19 09:00:00.000Z'
});
/** The token is set on the PC, the server does not see it yet. */
const BOT = connectionOf({
	id: 'conn00000000023',
	type: 'telegram',
	label: 'Bot',
	secretEnv: 'BYL_TELEGRAM_TOKEN',
	allowlistEnv: 'BYL_TELEGRAM_ALLOWED_IDS',
	created: '2026-10-19 10:00:00.000Z'
});

function inboxKeysOf(keys: InboxKey[]): InboxKeysStore {
	const data: InboxKeysData = {
		list: vi.fn(async () => keys),
		create: vi.fn(),
		revoke: vi.fn()
	};
	return new InboxKeysStore(data, { ensureValid: () => true, logout: vi.fn() });
}

const UNUSED_KEY: InboxKey = {
	id: 'key000000000001',
	name: 'Skript',
	tokenHint: 'byl_Ab12',
	created: OK,
	lastUsedAt: null
};

async function renderPage(items: Connection[], extra: Record<string, unknown> = {}) {
	const { data } = fakeConnectionsData(items, { secret: true, allowlist: true });
	data.secretStatus.mockImplementation(async (id) =>
		id === BOT.id ? { secret: false, allowlist: false } : { secret: true, allowlist: null }
	);
	const connections = await connectionsStoreOf(data);
	const credentials = credentialsStoreOf(
		fakeCredentialsData([
			variableOf('BYL_GOOGLE_CALENDAR_URL'),
			variableOf('BYL_TELEGRAM_TOKEN'),
			variableOf('BYL_TELEGRAM_ALLOWED_IDS')
		])
	);
	const view = render(ChannelsViewHarness, {
		props: { connections, credentials, onchange: vi.fn(), ...extra }
	});
	await vi.waitFor(() => expect(credentials.state).not.toBe('loading'));
	await tick();
	return { connections, credentials, view };
}

function overview() {
	return within(screen.getByRole('list', { name: /Einrichtung(en)? offen/ }));
}

beforeEach(async () => {
	sessionStorage.clear();
	localStorage.clear();
	await useContext(PC_CONTEXT);
});

afterEach(() => {
	delete document.documentElement.dataset.mobileLayout;
});

describe('overview of the open setups (KE-1, E2a)', () => {
	it('stands above the cards with the open step of each and "Fortsetzen" to its assistant', async () => {
		await renderPage([CALENDAR, DONE, BOT]);
		const heading = screen.getByRole('heading', { name: /2 Einrichtungen offen/ });
		expect(heading.tagName).toBe('H3');
		const cards = screen.getByRole('heading', { name: /Deine Verbindungen/ });
		expect(heading.compareDocumentPosition(cards) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		const items = overview()
			.getAllByRole('listitem')
			.map((item) => item.textContent?.replace(/\s+/g, ' ').trim());
		expect(items).toEqual([
			'Google Kalender: Schritt 7 von 7: Erster Abruf steht aus Fortsetzen: Google Kalender',
			'Bot: Schritt 5 von 7: Wartet auf Neustart Fortsetzen: Bot'
		]);
		const resume = overview().getByRole('link', { name: 'Fortsetzen: Google Kalender' });
		expect(resume.getAttribute('href')).toBe(
			`/einstellungen/kanaele?einrichten=kalender&verbindung=${CALENDAR.id}`
		);
		expect(resume.hasAttribute('data-sveltekit-keepfocus')).toBe(true);
		expect(resume.hasAttribute('data-sveltekit-replacestate')).toBe(true);
		expect(overview().getByRole('link', { name: 'Fortsetzen: Bot' }).getAttribute('href')).toBe(
			`/einstellungen/kanaele?einrichten=telegram&verbindung=${BOT.id}`
		);
		// The done connection is not listed.
		expect(overview().queryByText(/Familie/)).toBeNull();
	});

	it('names the same open step on the cards, never "Verbunden" while it is open', async () => {
		await renderPage([CALENDAR, DONE, BOT]);
		const calendar = within(screen.getByRole('article', { name: 'Google Kalender' }));
		expect(calendar.getByText('Einrichtung offen')).toBeTruthy();
		expect(calendar.queryByText('Verbunden')).toBeNull();
		expect(calendar.getByText('Offener Schritt „Erster Abruf“: Noch kein Abruf.')).toBeTruthy();
		const bot = within(screen.getByRole('article', { name: 'Bot' }));
		expect(
			bot.getByText(
				'Wartet auf Neustart: BYL_TELEGRAM_TOKEN und BYL_TELEGRAM_ALLOWED_IDS sind gesetzt, die App sieht sie erst nach einem Neustart.'
			)
		).toBeTruthy();
		expect(bot.queryByText(/Zugangsdaten fehlen/)).toBeNull();
		expect(
			within(screen.getByRole('article', { name: 'Familie' })).getByText('Verbunden')
		).toBeTruthy();
	});

	it('says "am PC fortsetzen" in the phone frame on another device, only for a step of the PC (M3)', async () => {
		document.documentElement.dataset.mobileLayout = 'on';
		await useContext(REMOTE_CONTEXT);
		await renderPage([CALENDAR, BOT]);
		const items = overview()
			.getAllByRole('listitem')
			.map((item) => item.textContent?.replace(/\s+/g, ' ').trim());
		// On another device the state on the PC is unknown: both, and the step needs the PC.
		expect(items).toEqual([
			'Google Kalender: Schritt 7 von 7: Erster Abruf steht aus Fortsetzen: Google Kalender',
			'Bot: Schritt 5 von 7: Zugangsdaten fehlen oder warten auf Neustart – am PC fortsetzen Fortsetzen: Bot'
		]);
		const bot = within(screen.getByRole('article', { name: 'Bot' }));
		expect(
			bot.getByText(
				'Zugangsdaten fehlen oder warten auf Neustart – am PC prüfen (BYL_TELEGRAM_TOKEN und BYL_TELEGRAM_ALLOWED_IDS).'
			)
		).toBeTruthy();
		// Every link is a button of the phone frame (44 px through .button-secondary, MO-1b).
		for (const link of overview().getAllByRole('link')) {
			expect(link.classList.contains('button-secondary')).toBe(true);
		}
	});

	it('leads the own inbox to its card and moves the focus there (no assistant)', async () => {
		const inboxKeys = inboxKeysOf([UNUSED_KEY]);
		await inboxKeys.load();
		await renderPage([DONE], { inboxKeys });
		const link = overview().getByRole('link', { name: 'Zur Karte: Eigener Eingang (API)' });
		expect(link.getAttribute('href')).toBe('/einstellungen/kanaele#karte-eigener-eingang');
		expect(link.closest('li')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
			'Eigener Eingang (API): Noch kein Programm hat einen Schlüssel benutzt Zur Karte: Eigener Eingang (API)'
		);
		// jsdom has no router: the browser would only move to the anchor of this page.
		link.addEventListener('click', (event) => event.preventDefault());
		await fireEvent.click(link);
		await vi.waitFor(() =>
			expect(document.activeElement).toBe(
				screen.getByRole('article', { name: 'Eigener Eingang (API)' })
			)
		);
	});

	it('shows nothing while no setup is open', async () => {
		await renderPage([DONE]);
		expect(screen.queryByRole('heading', { name: /Einrichtung(en)? offen/ })).toBeNull();
		expect(document.querySelector('[data-open-setups]')).toBeNull();
	});
});

describe('the mark at "Kanäle" and "Erste Schritte" (KE-1, E2b, E4)', () => {
	function openSetupsStore() {
		const data: OpenSetupsData = {
			list: vi.fn(async () => []),
			secretStatus: vi.fn(),
			inboxKeys: vi.fn(async () => []),
			extensionBuilt: vi.fn(async () => null)
		};
		return new OpenSetupsStore(data, { ensureValid: () => true, logout: vi.fn() });
	}

	it('hands what the page computed to the store of the layout', async () => {
		const openSetups = openSetupsStore();
		await renderPage([CALENDAR, DONE, BOT], { openSetups });
		await vi.waitFor(() => expect(openSetups.count).toBe(2));
		expect(openSetups.entries.map((entry) => entry.key)).toEqual([CALENDAR.id, BOT.id]);
	});

	it('marks "Einen Kanal einrichten" only once a setup is done, not for a connection alone (E4)', async () => {
		const firstSteps = new FirstStepsStore(() => window.localStorage);
		const first = await renderPage([CALENDAR, BOT], { firstSteps });
		await tick();
		expect(firstSteps.state.reached).not.toContain('channel');
		first.view.unmount();
		await renderPage([CALENDAR, DONE], { firstSteps });
		await vi.waitFor(() => expect(firstSteps.state.reached).toContain('channel'));
	});
});

describe('tile "Begonnen · Fortsetzen" (KE-1, E3)', () => {
	it('marks an assistant begun in this tab before its connection, and drops broken and expired entries', async () => {
		const now = Date.now();
		sessionStorage.setItem(
			'byl-setup:neu:telegram',
			serializeSetupResume({ step: 1, savedAt: now, restart: false, connect: null })
		);
		sessionStorage.setItem('byl-setup:neu:gmail', '{kaputt');
		sessionStorage.setItem(
			'byl-setup:neu:webde',
			serializeSetupResume({
				step: 2,
				savedAt: now - 3 * 60 * 60 * 1000,
				restart: false,
				connect: null
			})
		);
		await renderPage([DONE]);
		const catalog = within(screen.getByRole('region', { name: 'Kanal hinzufügen' }));
		const telegram = catalog.getByRole('link', { name: 'Fortsetzen: Telegram-Bot' });
		expect(telegram.getAttribute('href')).toBe('/einstellungen/kanaele?einrichten=telegram');
		expect(telegram.closest('li')?.textContent).toMatch(/Begonnen/);
		expect(catalog.getByRole('link', { name: 'Einrichten: Gmail' })).toBeTruthy();
		expect(catalog.getByRole('link', { name: 'Einrichten: Web.de' })).toBeTruthy();
		expect(sessionStorage.getItem('byl-setup:neu:gmail')).toBeNull();
		expect(sessionStorage.getItem('byl-setup:neu:webde')).toBeNull();
		expect(sessionStorage.getItem('byl-setup:neu:telegram')).not.toBeNull();
		// Nothing of it in localStorage (no new model of storage).
		expect(Object.keys(localStorage).filter((key) => key.startsWith('byl-setup'))).toEqual([]);
	});
});
