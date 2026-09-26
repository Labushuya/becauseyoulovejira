// Component tests of the card of a connection, the edit modal and the catalog (ADR-0026 section 3,
// plan EH-3): lozenge and meta per state, the main action per kind, the menu "…" on the popover
// building block, "Bearbeiten" as modal M with "Schließen", and the tiles of the catalog.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { ResolvedPathname } from '$app/types';
import type { Connection } from '$lib/domain/connections';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import ChannelCard from './ChannelCard.svelte';
import ChannelCatalog from './ChannelCatalog.svelte';
import ChannelEditModal from './ChannelEditModal.svelte';

useOverlayStubs();

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

function renderCard(value: Connection, running = false, message: string | null = null) {
	const callbacks = {
		onrun: vi.fn(),
		onpick: vi.fn(),
		onedit: vi.fn(),
		onpause: vi.fn(),
		ondelete: vi.fn(),
		onsetup: vi.fn()
	};
	render(ChannelCard, {
		props: {
			connection: value,
			secretStatus: { secret: true, allowlist: null },
			running,
			message,
			...callbacks
		}
	});
	return { card: within(screen.getByRole('article', { name: value.label })), ...callbacks };
}

describe('channel card', () => {
	it('is an article named by its heading with kind, lozenge and meta', () => {
		const { card } = renderCard(connection());
		expect(card.getByRole('heading', { level: 4, name: 'Kalender' })).toBeTruthy();
		expect(card.getByText('Google Calendar')).toBeTruthy();
		expect(card.getByText('Eingerichtet').closest('[data-tone]')?.getAttribute('data-tone')).toBe(
			'brand'
		);
		expect(card.getByText('25.09.2026 10:15')).toBeTruthy();
		expect(card.getByText('2 (todo, ticket)')).toBeTruthy();
		expect(card.queryByText(/zuletzt erfolgreich/)).toBeNull();
	});

	it('runs a calendar and names the connection in every action', async () => {
		const { card, onrun, onedit } = renderCard(connection());
		await fireEvent.click(card.getByRole('button', { name: 'Jetzt abrufen: Kalender' }));
		expect(onrun).toHaveBeenCalledOnce();
		const edit = card.getByRole('button', { name: 'Bearbeiten: Kalender' });
		expect(edit.getAttribute('aria-haspopup')).toBe('dialog');
		await fireEvent.click(edit);
		expect(onedit).toHaveBeenCalledOnce();
	});

	it('offers the mailbox selection instead of a run for mailboxes', async () => {
		const { card, onpick } = renderCard(
			connection({ type: 'mail', label: 'Gmail', mailProvider: 'gmail', mailUser: 'a@gmail.com' })
		);
		expect(card.getByText('Postfach · Gmail · a@gmail.com')).toBeTruthy();
		expect(card.queryByRole('button', { name: /^Jetzt abrufen/ })).toBeNull();
		await fireEvent.click(card.getByRole('button', { name: 'Aus dem Postfach wählen: Gmail' }));
		expect(onpick).toHaveBeenCalledOnce();
	});

	it('marks a running fetch with a busy button', () => {
		const { card } = renderCard(connection(), true);
		expect(card.getByText('Wird abgerufen')).toBeTruthy();
		const button = card.getByRole('button', { name: 'Wird abgerufen …: Kalender' });
		expect(button.getAttribute('aria-busy')).toBe('true');
	});

	it('shows an error of its last action as live error message', () => {
		const { card } = renderCard(connection(), false, 'Server nicht erreichbar.');
		const alert = card.getByRole('alert');
		expect(alert.textContent).toMatch(/Server nicht erreichbar\./);
	});

	it('holds pausing, the setup and deleting in the menu "…"', async () => {
		const { card, onpause, onsetup, ondelete } = renderCard(connection());
		const trigger = card.getByRole('button', { name: 'Weitere Aktionen für Kalender' });
		expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
		const menu = within(document.getElementById(trigger.getAttribute('aria-controls') ?? '')!);
		expect(
			menu.getAllByRole('menuitem', { hidden: true }).map((item) => item.textContent?.trim())
		).toEqual(['Pausieren', 'Einrichtung ansehen', 'Löschen …']);
		expect(menu.getByRole('separator', { hidden: true })).toBeTruthy();

		await fireEvent.click(trigger);
		await fireEvent.click(menu.getByRole('menuitem', { name: 'Pausieren', hidden: true }));
		expect(onpause).toHaveBeenCalledWith(false);
		await fireEvent.click(trigger);
		await fireEvent.click(
			menu.getByRole('menuitem', { name: 'Einrichtung ansehen', hidden: true })
		);
		expect(onsetup).toHaveBeenCalledOnce();
		await fireEvent.click(trigger);
		await fireEvent.click(menu.getByRole('menuitem', { name: 'Löschen …', hidden: true }));
		expect(ondelete).toHaveBeenCalledOnce();
	});

	it('offers "Fortsetzen" for a paused connection, in the card and in the menu', async () => {
		const { card, onpause } = renderCard(connection({ enabled: false }));
		expect(card.getByText('Pausiert')).toBeTruthy();
		await fireEvent.click(card.getByRole('button', { name: 'Fortsetzen: Kalender' }));
		expect(onpause).toHaveBeenCalledWith(true);
		const trigger = card.getByRole('button', { name: 'Weitere Aktionen für Kalender' });
		const menu = within(document.getElementById(trigger.getAttribute('aria-controls') ?? '')!);
		expect(menu.getByRole('menuitem', { name: 'Fortsetzen', hidden: true })).toBeTruthy();
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
		await fireEvent.click(scope.getByRole('checkbox', { name: /ohne Stichwort antworten/ }));
		expect(onreply).toHaveBeenCalledWith(false);
		const close = scope.getAllByRole('button', { name: 'Schließen' });
		expect(close.length).toBeGreaterThanOrEqual(2);
		expect(scope.queryByRole('button', { name: 'Abbrechen' })).toBeNull();
		await fireEvent.click(close[close.length - 1] as HTMLElement);
		expect(onclose).toHaveBeenCalled();
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
			'Proton Mail'
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
		expect(catalog.queryAllByRole('button')).toEqual([]);
	});
});
