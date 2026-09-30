// Component tests of the card building block and of the card of a connection, the edit modal and
// the catalog (ADR-0026 section 3 and addendum of 2026-09-30; plans EH-3 and kanal-karten KK-2):
// one header with lozenge, one info line, one main button per state, the menu "•••" on the
// popover building block, the folded details, "Stichwörter und Einstellungen …" as modal M with
// "Schließen", and the tiles of the catalog.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedPathname } from '$app/types';
import { CARD_STATUS } from '$lib/domain/channel-card';
import {
	MAIL_INBOX_HINT,
	lastResultText,
	type Connection,
	type MailHelperStatus,
	type RunResult
} from '$lib/domain/connections';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import ChannelCard from './ChannelCard.svelte';
import ChannelCatalog from './ChannelCatalog.svelte';
import ChannelEditModal from './ChannelEditModal.svelte';
import ConnectionCard from './ConnectionCard.svelte';

useOverlayStubs();

afterEach(() => {
	vi.useRealTimers();
});

const EMPTY_RUN: RunResult = {
	status: 'ok',
	created: 0,
	duplicates: 0,
	updated: 0,
	skipped: 0,
	failed: 0,
	unmatched: 0,
	error: '',
	missing: []
};

function connection(overrides: Partial<Connection> = {}): Connection {
	return {
		id: 'conn00000000001',
		type: 'calendar',
		label: 'Kalender',
		enabled: true,
		secretEnv: 'BYL_GOOGLE_CALENDAR_URL',
		allowlistEnv: '',
		lastRunAt: '2026-09-25 08:15:00.000Z',
		lastOkAt: '2026-09-25 08:15:00.000Z',
		lastError: '',
		lastHint: '',
		keywords: ['todo', 'ticket'],
		replyNoMatch: true,
		mailProvider: '',
		mailUser: '',
		matchBody: false,
		runningSince: null,
		created: '2026-09-25 08:00:00.000Z',
		updated: '2026-09-25 08:00:00.000Z',
		...overrides
	};
}

function callbacks() {
	return {
		onrun: vi.fn(),
		onpick: vi.fn(),
		onedit: vi.fn(),
		onpause: vi.fn(),
		ondelete: vi.fn(),
		onsetup: vi.fn(),
		onscan: vi.fn()
	};
}

function renderCard(
	value: Connection,
	options: {
		running?: boolean;
		message?: string | null;
		helper?: MailHelperStatus | null;
		lastRun?: RunResult | null;
	} = {}
) {
	const spies = callbacks();
	render(ConnectionCard, {
		props: {
			connection: value,
			secretStatus: { secret: true, allowlist: null },
			running: options.running ?? false,
			message: options.message ?? null,
			helper: options.helper ?? null,
			lastRun: options.lastRun ?? null,
			...spies
		}
	});
	const article = screen.getByRole('article', { name: value.label });
	return { article, card: within(article), ...spies };
}

/** The main button of a card (exactly one). */
function primaryOf(article: HTMLElement): HTMLElement {
	const found = article.querySelectorAll<HTMLElement>('[data-card-primary]');
	expect(found).toHaveLength(1);
	return found[0] as HTMLElement;
}

/** The menu "•••" of a card; jsdom shows popovers as hidden. */
function menuOf(article: HTMLElement, name: string) {
	const trigger = within(article).getByRole('button', { name: `Weitere Aktionen für ${name}` });
	const menu = within(document.getElementById(trigger.getAttribute('aria-controls') ?? '')!);
	const items = () =>
		menu.getAllByRole('menuitem', { hidden: true }).map((item) => item.textContent?.trim());
	return { trigger, menu, items };
}

async function choose(article: HTMLElement, name: string, entry: string) {
	const { trigger, menu } = menuOf(article, name);
	await fireEvent.click(trigger);
	await fireEvent.click(menu.getByRole('menuitem', { name: entry, hidden: true }));
}

/** Opens the details of a card and returns them. */
async function openDetails(article: HTMLElement, name: string) {
	const toggle = within(article).getByRole('button', { name: `Details: ${name}` });
	await fireEvent.click(toggle);
	return within(document.getElementById(toggle.getAttribute('aria-controls') ?? '')!);
}

describe('channel card building block (KK-2)', () => {
	const details = createRawSnippet(() => ({
		render: () => '<dl><div><dt>Stichwörter</dt><dd>2 (todo, ticket)</dd></div></dl>'
	}));

	it('has a header with name, kind and state as text, one info line and one main button', async () => {
		const onselect = vi.fn();
		render(ChannelCard, {
			props: {
				icon: 'calendar',
				title: 'Kalender',
				subtitle: 'Google Calendar',
				status: CARD_STATUS.connected,
				info: 'Zuletzt abgerufen vor 5 Min. · 3 neu',
				primary: { label: 'Jetzt abrufen', onselect },
				menu: [
					{ label: 'Pausieren', onselect: vi.fn() },
					{ label: 'Hilfe', href: '/einstellungen/hilfe#zugangsdaten' as ResolvedPathname },
					{ label: 'Löschen …', dialog: true, separated: true, onselect: vi.fn() }
				],
				details,
				anchor: 'verbindung-x'
			}
		});
		const article = screen.getByRole('article', { name: 'Kalender' });
		const card = within(article);
		expect(card.getByRole('heading', { level: 4, name: 'Kalender' })).toBeTruthy();
		expect(card.getByText('Google Calendar')).toBeTruthy();
		expect(card.getByText('Verbunden').closest('[data-tone]')?.getAttribute('data-tone')).toBe(
			'brand'
		);
		expect(article.querySelectorAll('.info-line')).toHaveLength(1);
		expect(card.getByText('Zuletzt abgerufen vor 5 Min. · 3 neu')).toBeTruthy();
		expect(article.id).toBe('verbindung-x');
		expect(article.getAttribute('tabindex')).toBe('-1');

		const main = primaryOf(article);
		expect(main.textContent).toBe('Jetzt abrufen: Kalender');
		await fireEvent.click(main);
		expect(onselect).toHaveBeenCalledOnce();

		const { trigger, menu, items } = menuOf(article, 'Kalender');
		expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
		expect(items()).toEqual(['Pausieren', 'Hilfe', 'Löschen …']);
		expect(menu.getByRole('separator', { hidden: true })).toBeTruthy();
		expect(menu.getByRole('menuitem', { name: 'Hilfe', hidden: true }).getAttribute('href')).toBe(
			'/einstellungen/hilfe#zugangsdaten'
		);
		expect(
			menu.getByRole('menuitem', { name: 'Löschen …', hidden: true }).getAttribute('aria-haspopup')
		).toBe('dialog');
	});

	it('folds the details open and closed with a disclosure button', async () => {
		render(ChannelCard, {
			props: {
				icon: 'calendar',
				title: 'Kalender',
				subtitle: 'Google Calendar',
				info: 'Noch nie abgerufen',
				primary: { label: 'Jetzt abrufen', onselect: vi.fn() },
				details
			}
		});
		const article = screen.getByRole('article', { name: 'Kalender' });
		const toggle = within(article).getByRole('button', { name: 'Details: Kalender' });
		const region = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
		expect(toggle.getAttribute('aria-expanded')).toBe('false');
		expect(region?.hidden).toBe(true);
		await fireEvent.click(toggle);
		expect(toggle.getAttribute('aria-expanded')).toBe('true');
		expect(region?.hidden).toBe(false);
		expect(within(region!).getByText('2 (todo, ticket)')).toBeTruthy();
		await fireEvent.click(toggle);
		expect(region?.hidden).toBe(true);
		// Without a menu there is no button "•••".
		expect(within(article).queryByRole('button', { name: /Weitere Aktionen/ })).toBeNull();
	});

	it('marks a running main action busy and a locked one as not possible, and runs neither', async () => {
		const onselect = vi.fn();
		const { rerender } = render(ChannelCard, {
			props: {
				icon: 'api',
				title: 'Eigener Eingang (API)',
				subtitle: 'Für eigene Skripte',
				info: 'Zugangsschlüssel werden geladen …',
				busy: true,
				primary: { label: 'Wird abgerufen …', busy: true, onselect }
			}
		});
		const article = screen.getByRole('article', { name: 'Eigener Eingang (API)' });
		expect(article.getAttribute('aria-busy')).toBe('true');
		expect(within(article).getByRole('status').textContent).toBe(
			'Zugangsschlüssel werden geladen …'
		);
		let main = primaryOf(article);
		expect(main.getAttribute('aria-busy')).toBe('true');
		expect(main.getAttribute('aria-disabled')).toBe('true');
		await fireEvent.click(main);
		await rerender({ busy: false, primary: { label: 'Erzeugen …', locked: true, onselect } });
		main = primaryOf(article);
		expect(main.getAttribute('aria-busy')).toBeNull();
		expect(main.getAttribute('aria-disabled')).toBe('true');
		await fireEvent.click(main);
		expect(onselect).not.toHaveBeenCalled();
		// A link as main action (an assistant in the address keeps focus and scroll).
		await rerender({
			primary: {
				label: 'Einrichten',
				href: '/einstellungen/kanaele?einrichten=whatsapp-web' as ResolvedPathname,
				inPlace: true
			}
		});
		main = primaryOf(article);
		expect(main.tagName).toBe('A');
		expect(main.getAttribute('href')).toBe('/einstellungen/kanaele?einrichten=whatsapp-web');
		expect(main.hasAttribute('data-sveltekit-keepfocus')).toBe(true);
		expect(main.hasAttribute('data-sveltekit-replacestate')).toBe(true);
	});
});

describe('channel card', () => {
	it('is an article named by its heading with kind, lozenge and one info line', async () => {
		vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
		vi.setSystemTime(Date.parse('2026-09-25T08:20:00Z'));
		const { article, card } = renderCard(connection());
		expect(card.getByRole('heading', { level: 4, name: 'Kalender' })).toBeTruthy();
		expect(card.getByText('Google Calendar')).toBeTruthy();
		expect(card.getByText('Verbunden').closest('[data-tone]')?.getAttribute('data-tone')).toBe(
			'brand'
		);
		expect(card.getByText('Zuletzt abgerufen vor 5 Min. · ohne Fehler')).toBeTruthy();
		// The relative time follows the clock while the card is shown.
		await vi.advanceTimersByTimeAsync(60_000);
		expect(card.getByText('Zuletzt abgerufen vor 6 Min. · ohne Fehler')).toBeTruthy();
		const details = await openDetails(article, 'Kalender');
		expect(details.getByText('25.09.2026 10:15')).toBeTruthy();
		expect(details.getByText('2 (todo, ticket)')).toBeTruthy();
		expect(details.queryByText(/zuletzt erfolgreich/)).toBeNull();
		expect(details.queryByText(MAIL_INBOX_HINT)).toBeNull();
		// No variables on the card: they stand in the edit modal (ADR-0018).
		expect(card.queryByText('BYL_GOOGLE_CALENDAR_URL')).toBeNull();
	});

	it('says at a mailbox that the whole inbox is searched (full inbox)', async () => {
		const { article } = renderCard(
			connection({ type: 'mail', label: 'Web.de', mailProvider: 'webde', mailUser: 'anna@web.de' })
		);
		const details = await openDetails(article, 'Web.de');
		expect(details.getByText('Automatisch')).toBeTruthy();
		expect(details.getByText(MAIL_INBOX_HINT)).toBeTruthy();
		expect(details.getByText('Betreff und Absender')).toBeTruthy();
		expect(MAIL_INBOX_HINT).toBe(
			'Der gesamte Posteingang wird durchsucht (nicht Papierkorb/Spam/Gesendet).'
		);
	});

	it('repeats the hint in the edit modal of a mailbox (package A)', () => {
		render(ChannelEditModal, {
			props: {
				connection: connection({
					type: 'mail',
					label: 'Web.de',
					mailProvider: 'webde',
					mailUser: 'anna@web.de'
				}),
				onkeywords: vi.fn(async () => null),
				onreply: vi.fn(),
				onmatchbody: vi.fn(),
				onsetup: vi.fn(),
				onclose: vi.fn()
			}
		});
		const dialog = within(screen.getByRole('dialog', { name: 'Web.de bearbeiten' }));
		expect(dialog.getByText(MAIL_INBOX_HINT)).toBeTruthy();
		expect(
			dialog.getByText(/Neue Stichwörter gelten auch für ältere Mails im Posteingang/)
		).toBeTruthy();
		expect(dialog.getByText(/Groß-\/Kleinschreibung egal/)).toBeTruthy();
		expect(dialog.getByText(/in Betreff und Absender \(Name und Adresse\)/)).toBeTruthy();
	});

	it('runs a calendar and names the connection in the main button', async () => {
		const { article, onrun, onedit } = renderCard(connection());
		const main = primaryOf(article);
		expect(main.textContent).toBe('Jetzt abrufen: Kalender');
		await fireEvent.click(main);
		expect(onrun).toHaveBeenCalledOnce();
		await choose(article, 'Kalender', 'Stichwörter und Einstellungen …');
		expect(onedit).toHaveBeenCalledOnce();
	});

	it('offers "Jetzt abrufen" as main button and the mailbox selection in the menu (package A)', async () => {
		const { article, card, onpick, onrun } = renderCard(
			connection({ type: 'mail', label: 'Gmail', mailProvider: 'gmail', mailUser: 'a@gmail.com' })
		);
		expect(card.getByText('Postfach · Gmail · a@gmail.com')).toBeTruthy();
		await fireEvent.click(card.getByRole('button', { name: 'Jetzt abrufen: Gmail' }));
		expect(onrun).toHaveBeenCalledOnce();
		const { menu } = menuOf(article, 'Gmail');
		expect(
			menu
				.getByRole('menuitem', { name: 'Aus dem Postfach wählen …', hidden: true })
				.getAttribute('aria-haspopup')
		).toBe('dialog');
		await choose(article, 'Gmail', 'Aus dem Postfach wählen …');
		expect(onpick).toHaveBeenCalledOnce();
	});

	it('says honestly whether the mail helper runs (package A)', async () => {
		const mail = connection({ type: 'mail', label: 'Web.de', mailProvider: 'webde' });
		const cases: [MailHelperStatus | null, RegExp, string][] = [
			[null, /^wird geprüft …$/, 'Verbunden'],
			[
				{ state: 'running', version: '0.5.0', message: '' },
				/^läuft \(byl-mail 0\.5\.0\)$/,
				'Verbunden'
			],
			[
				{ state: 'stopped', version: '', message: '' },
				/^läuft nicht\. .*neu-starten\.bat/,
				'Neustart nötig'
			],
			[{ state: 'refused', version: '', message: '' }, /BYL_INGEST_TOKEN/, 'Neustart nötig'],
			[
				{ state: 'outdated', version: '', message: '' },
				/älteren Version.*neu-starten\.bat/,
				'Neustart nötig'
			]
		];
		for (const [helper, text, lozenge] of cases) {
			const spies = callbacks();
			const { unmount } = render(ConnectionCard, {
				props: {
					connection: mail,
					secretStatus: { secret: true, allowlist: null },
					running: false,
					helper,
					...spies
				}
			});
			const article = screen.getByRole('article', { name: 'Web.de' });
			expect(within(article).getByText(lozenge)).toBeTruthy();
			const details = await openDetails(article, 'Web.de');
			const row = details.getByText('Hilfsprozess').closest('div') as HTMLElement;
			expect(within(row).getByRole('definition').textContent?.trim()).toMatch(text);
			if (lozenge === 'Neustart nötig') {
				// The one hint says why, and "Jetzt abrufen" asks the helper again.
				expect(within(article).getByText(/^Hilfsprozess läuft/)).toBeTruthy();
				expect(primaryOf(article).textContent).toBe('Jetzt abrufen: Web.de');
			}
			unmount();
		}
		// Other kinds do not need the helper.
		const { article } = renderCard(connection());
		const details = await openDetails(article, 'Kalender');
		expect(details.queryByText('Hilfsprozess')).toBeNull();
	});

	it('shows the result of the last run: counts on this page, else with or without error (package A)', async () => {
		expect(lastResultText({ lastRunAt: null, lastError: '' }, null)).toBeNull();
		expect(lastResultText({ lastRunAt: '2026-09-25 08:15:00.000Z', lastError: '' }, null)).toBe(
			'ohne Fehler'
		);
		expect(lastResultText({ lastRunAt: '2026-09-25 08:15:00.000Z', lastError: 'x' }, null)).toBe(
			'fehlgeschlagen'
		);
		const run = { ...EMPTY_RUN, status: 'ok' as const, created: 2, unmatched: 1 };
		expect(lastResultText({ lastRunAt: null, lastError: '' }, run)).toBe('2 neu, 1 ohne Stichwort');
		expect(
			lastResultText({ lastRunAt: null, lastError: '' }, { ...EMPTY_RUN, status: 'unavailable' })
		).toBe('Hilfsprozess läuft nicht');

		const { article, card } = renderCard(connection(), { lastRun: run });
		expect(card.getByText(/· 2 neu, 1 ohne Stichwort$/)).toBeTruthy();
		const details = await openDetails(article, 'Kalender');
		expect(details.getByText('Ergebnis')).toBeTruthy();
		expect(details.getByText('2 neu, 1 ohne Stichwort')).toBeTruthy();
		// The anchor of "Zur Karte" in the flag of "Alle Kanäle jetzt abrufen".
		expect(article.id).toBe('verbindung-conn00000000001');
		expect(article.getAttribute('tabindex')).toBe('-1');
	});

	it('marks a running fetch with a busy main button', () => {
		const { article, card } = renderCard(connection(), { running: true });
		expect(card.getByText('Wird abgerufen')).toBeTruthy();
		const button = card.getByRole('button', { name: 'Wird abgerufen …: Kalender' });
		expect(button).toBe(primaryOf(article));
		expect(button.getAttribute('aria-busy')).toBe('true');
		expect(button.getAttribute('aria-disabled')).toBe('true');
	});

	it('shows an error of its last action as live error message', () => {
		const { card } = renderCard(connection(), { message: 'Server nicht erreichbar.' });
		const alert = card.getByRole('alert');
		expect(alert.textContent).toMatch(/Server nicht erreichbar\./);
	});

	it('shows the last error as hint and in the details', async () => {
		const { article, card } = renderCard(
			connection({ lastError: 'HTTP 404', lastOkAt: '2026-09-24 08:15:00.000Z' })
		);
		expect(card.getByText('Fehler').closest('[data-tone]')?.getAttribute('data-tone')).toBe(
			'danger'
		);
		expect(card.getByText(/Letzter Fehler: HTTP 404/)).toBeTruthy();
		expect(primaryOf(article).textContent).toBe('Jetzt abrufen: Kalender');
		const details = await openDetails(article, 'Kalender');
		expect(details.getByText(/zuletzt erfolgreich 24\.09\.2026 10:15/)).toBeTruthy();
		expect(details.getByText('Letzter Fehler')).toBeTruthy();
	});

	it('holds the keywords, pausing, the setup, the help and deleting in the menu "•••"', async () => {
		const { article, onpause, onsetup, ondelete, onedit } = renderCard(connection());
		const { trigger, menu, items } = menuOf(article, 'Kalender');
		expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
		expect(items()).toEqual([
			'Stichwörter und Einstellungen …',
			'Pausieren',
			'Einrichtung ansehen',
			'Hilfe',
			'Löschen …'
		]);
		expect(menu.getByRole('separator', { hidden: true })).toBeTruthy();
		expect(menu.getByRole('menuitem', { name: 'Hilfe', hidden: true }).getAttribute('href')).toBe(
			'/einstellungen/hilfe#zugangsdaten'
		);

		await choose(article, 'Kalender', 'Stichwörter und Einstellungen …');
		expect(onedit).toHaveBeenCalledOnce();
		await choose(article, 'Kalender', 'Pausieren');
		expect(onpause).toHaveBeenCalledWith(false);
		await choose(article, 'Kalender', 'Einrichtung ansehen');
		expect(onsetup).toHaveBeenCalledOnce();
		await choose(article, 'Kalender', 'Löschen …');
		expect(ondelete).toHaveBeenCalledOnce();
	});

	it('offers "Fortsetzen" for a paused connection as main button, not twice', async () => {
		const { article, card, onpause } = renderCard(connection({ enabled: false }));
		expect(card.getByText('Pausiert')).toBeTruthy();
		await fireEvent.click(card.getByRole('button', { name: 'Fortsetzen: Kalender' }));
		expect(onpause).toHaveBeenCalledWith(true);
		expect(menuOf(article, 'Kalender').items()).not.toContain('Fortsetzen');
		expect(menuOf(article, 'Kalender').items()).not.toContain('Pausieren');
	});

	it('leads a connection without its variable to the setup (main button)', () => {
		const spies = callbacks();
		render(ConnectionCard, {
			props: {
				connection: connection(),
				secretStatus: { secret: false, allowlist: null },
				running: false,
				...spies
			}
		});
		const article = screen.getByRole('article', { name: 'Kalender' });
		expect(within(article).getByText('Einrichtung offen')).toBeTruthy();
		expect(primaryOf(article).textContent).toBe('Einrichtung fortsetzen: Kalender');
		expect(menuOf(article, 'Kalender').items()).not.toContain('Einrichtung ansehen');
	});
});

describe('full scan of an inbox on the card (ADR-0020, addendum 3)', () => {
	const MAIL = {
		type: 'mail' as const,
		label: 'Web.de',
		mailProvider: 'webde' as const,
		mailUser: 'anna@web.de'
	};

	it('shows the progress of a running scan in the info line and cancels it', async () => {
		const scan = {
			state: 'running' as const,
			done: 1200,
			total: 4800,
			created: 7,
			fallback: false
		};
		const { article, card, onscan, onrun } = renderCard(connection({ ...MAIL, scan }));
		expect(card.getByText('Posteingang wird durchsucht: 1.200/4.800')).toBeTruthy();
		const bar = article.querySelector('progress');
		expect(bar?.getAttribute('value')).toBe('1200');
		expect(bar?.getAttribute('max')).toBe('4800');
		const main = primaryOf(article);
		expect(main.textContent).toBe('Durchsuchen abbrechen: Web.de');
		await fireEvent.click(main);
		expect(onscan).toHaveBeenCalledWith('cancel');
		// "Jetzt abrufen" stays reachable in the menu.
		await choose(article, 'Web.de', 'Jetzt abrufen');
		expect(onrun).toHaveBeenCalledOnce();
		const details = await openDetails(article, 'Web.de');
		expect(details.getByText('Posteingang')).toBeTruthy();
	});

	it('says how a finished, paused or cancelled scan ended, without "Abbrechen" or a bar', async () => {
		const cases: [NonNullable<Connection['scan']>, RegExp][] = [
			[
				{ state: 'done', done: 4800, total: 4800, created: 12, fallback: false },
				/durchsucht: 4\.800 Mails, 12 Einträge übernommen/
			],
			[
				{ state: 'paused', done: 900, total: 4800, created: 200, fallback: false },
				/pausiert bei 900\/4\.800, bisher 200 Einträge übernommen/
			],
			[
				{ state: 'cancelled', done: 500, total: 4800, created: 1, fallback: false },
				/abgebrochen bei 500\/4\.800/
			]
		];
		for (const [scan, text] of cases) {
			const label = `Web.de ${scan.state}`;
			const { article } = renderCard(
				connection({ ...MAIL, id: `conn-${scan.state}`, label, scan })
			);
			const details = await openDetails(article, label);
			expect(details.getByText(text)).toBeTruthy();
			expect(primaryOf(article).textContent).toBe(`Jetzt abrufen: ${label}`);
			expect(menuOf(article, label).items()).not.toContain('Durchsuchen abbrechen');
		}
		expect(document.querySelector('progress')).toBeNull();
	});

	it('offers "Posteingang neu durchsuchen" in the menu of a set-up mailbox only', async () => {
		const { article, onscan } = renderCard(connection({ ...MAIL, scan: null }));
		expect(menuOf(article, 'Web.de').items()).toEqual([
			'Aus dem Postfach wählen …',
			'Stichwörter und Einstellungen …',
			'Pausieren',
			'Posteingang neu durchsuchen',
			'Einrichtung ansehen',
			'Hilfe',
			'Löschen …'
		]);
		await choose(article, 'Web.de', 'Posteingang neu durchsuchen');
		expect(onscan).toHaveBeenCalledWith('start');
		const paused = renderCard(
			connection({ ...MAIL, id: 'conn-aus', label: 'Aus', enabled: false })
		);
		expect(menuOf(paused.article, 'Aus').items()).not.toContain('Posteingang neu durchsuchen');
	});
});

describe('channel edit modal', () => {
	it('is a modal M named after the connection with keywords, switch, variables and "Schließen"', async () => {
		const onclose = vi.fn();
		const onreply = vi.fn();
		render(ChannelEditModal, {
			props: {
				connection: connection({
					type: 'telegram',
					label: 'Bot',
					secretEnv: 'BYL_TELEGRAM_TOKEN',
					allowlistEnv: 'BYL_TELEGRAM_ALLOWED_IDS'
				}),
				onkeywords: vi.fn(async () => null),
				onreply,
				onmatchbody: vi.fn(),
				onsetup: vi.fn(),
				onclose
			}
		});
		const dialog = screen.getByRole('dialog', { name: 'Bot bearbeiten' });
		const scope = within(dialog);
		expect(scope.getByRole('list', { name: 'Stichwörter von „Bot“' })).toBeTruthy();
		expect(scope.getByText('BYL_TELEGRAM_TOKEN')).toBeTruthy();
		expect(scope.getByText('BYL_TELEGRAM_ALLOWED_IDS')).toBeTruthy();
		// A switch after Apple HIG (ADR-0029, G-5): a checkbox with role="switch", name left.
		const reply = scope.getByRole<HTMLInputElement>('switch', { name: /ohne Stichwort antworten/ });
		expect(reply.getAttribute('type')).toBe('checkbox');
		expect(reply.closest('label')?.firstElementChild?.tagName).toBe('SPAN');
		await fireEvent.click(reply);
		expect(onreply).toHaveBeenCalledWith(false);
		const close = scope.getAllByRole('button', { name: 'Schließen' });
		expect(close.length).toBeGreaterThanOrEqual(2);
		expect(scope.queryByRole('button', { name: 'Abbrechen' })).toBeNull();
		await fireEvent.click(close[close.length - 1] as HTMLElement);
		expect(onclose).toHaveBeenCalled();
	});

	it('shows the text search of a mailbox as a switch (ADR-0029, G-5)', async () => {
		const onmatchbody = vi.fn();
		render(ChannelEditModal, {
			props: {
				connection: connection({ type: 'mail', label: 'Web.de', matchBody: false }),
				onkeywords: vi.fn(async () => null),
				onreply: vi.fn(),
				onmatchbody,
				onsetup: vi.fn(),
				onclose: vi.fn()
			}
		});
		const dialog = within(screen.getByRole('dialog', { name: 'Web.de bearbeiten' }));

		const search = dialog.getByRole<HTMLInputElement>('switch', {
			name: 'Betreff, Absender, Kopfzeilen und Text durchsuchen'
		});
		expect(search.checked).toBe(false);
		expect(dialog.queryByRole('checkbox', { name: /durchsuchen/ })).toBeNull();
		expect(dialog.queryByRole('switch', { name: /ohne Stichwort antworten/ })).toBeNull();
		await fireEvent.click(search);

		expect(onmatchbody).toHaveBeenCalledExactlyOnceWith(true);
	});
});

describe('channel catalog', () => {
	it('offers one tile per service and marks the kinds without a connection', async () => {
		render(ChannelCatalog, {
			props: {
				connections: [connection(), connection({ id: 'x', type: 'mail', mailProvider: 'gmail' })],
				hrefOf: (entry) => `/einstellungen/kanaele?einrichten=${entry}` as ResolvedPathname
			}
		});
		const catalog = within(screen.getByRole('region', { name: 'Kanal hinzufügen' }));
		const tiles = catalog.getAllByRole('listitem');
		expect(tiles.map((tile) => within(tile).getByRole('heading').textContent)).toEqual([
			'Google Calendar',
			'Telegram-Bot',
			'Web.de',
			'Gmail',
			'Proton Mail',
			'Notion (Listen übernehmen)',
			'WhatsApp Web'
		]);
		expect(within(tiles[0]!).queryByText('Nicht eingerichtet')).toBeNull();
		expect(
			within(tiles[0]!).getByRole('link', { name: 'Weitere einrichten: Google Calendar' })
		).toBeTruthy();
		expect(within(tiles[1]!).getByText('Nicht eingerichtet')).toBeTruthy();
		expect(within(tiles[2]!).getByText('Nicht eingerichtet')).toBeTruthy();
		expect(within(tiles[3]!).queryByText('Nicht eingerichtet')).toBeNull();
		expect(within(tiles[4]!).getByText('Per Datei')).toBeTruthy();

		// Since EH-5 to EH-7 every tile links to its assistant or guide (a middle click works too).
		expect(catalog.getByRole('link', { name: 'Einrichten: Web.de' }).getAttribute('href')).toBe(
			'/einstellungen/kanaele?einrichten=webde'
		);
		expect(catalog.getByRole('link', { name: 'Anleitung: Proton Mail' }).getAttribute('href')).toBe(
			'/einstellungen/kanaele?einrichten=proton'
		);
		// Notion (ADR-0041) only imports on request: the tile says so and leads to its assistant.
		expect(within(tiles[5]!).getByText('Import')).toBeTruthy();
		expect(catalog.getByRole('link', { name: 'Einrichten: Notion' }).getAttribute('href')).toBe(
			'/einstellungen/kanaele?einrichten=notion'
		);
		// The browser extension for WhatsApp Web (ADR-0038) has no connection.
		expect(within(tiles[6]!).getByText('Erweiterung')).toBeTruthy();
		expect(
			catalog.getByRole('link', { name: 'Einrichten: WhatsApp Web' }).getAttribute('href')
		).toBe('/einstellungen/kanaele?einrichten=whatsapp-web');
		expect(catalog.queryAllByRole('button')).toEqual([]);
	});
});
