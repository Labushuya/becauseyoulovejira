// The hint "restart needed" with "Jetzt neu starten" (BW-2, ADR-0072 addendum): the button of the
// page System only for the administrator on the machine of the app under Windows, with the same
// question, route, checks, progress and result; in every other tab the way as text, never a script;
// locked without a connection; the files of the folder app only folded under „Notfall“; the store of
// the (app) layout by default, the one of the page when it passes one. Data layer and outbox are
// fakes; the store, the dialog and the building blocks are real.

import type PocketBase from 'pocketbase';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { noteRequest } from '$lib/data/errors';
import { runSystemAction } from '$lib/data/system';
import type { AppContext } from '$lib/domain/context';
import { RESTART_WAY } from '$lib/domain/system';
import { restartNeeded } from '$lib/guidance/texts';
import type { OutboxStore } from '$lib/offline/outbox.svelte';
import { problemLog } from '$lib/stores/problem-log.svelte';
import { RestartStore } from '$lib/stores/restart.svelte';
import { MEMBER_CONTEXT, PC_CONTEXT, REMOTE_CONTEXT, useContext } from '$lib/test/context';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import {
	fakeRestartClock,
	fakeRestartData,
	ok,
	restartOverview,
	restartStoreOf
} from '$lib/test/restart-fake';
import RestartNoticeHarness from '$lib/test/RestartNoticeHarness.svelte';
import RestartNeededNotice from './RestartNeededNotice.svelte';

useOverlayStubs();

const LINUX_CONTEXT: AppContext = { ...PC_CONTEXT, platform: 'linux', scripts: false };

/** The notice without its folded emergency way. */
function outsideEmergency(container: HTMLElement): string {
	const copy = container.cloneNode(true) as HTMLElement;
	for (const details of copy.querySelectorAll('details')) details.remove();
	return copy.textContent ?? '';
}

/** A client of the SDK whose every request fails like the SDK with 502 "script". */
function failingClient(): PocketBase {
	return {
		send: vi.fn(async (path: string, options: { method: string }) => {
			const error = {
				status: 502,
				url: `http://127.0.0.1:8090${path}`,
				isAbort: false,
				response: { reason: 'script', message: 'Das Steuerskript hat abgebrochen.' }
			};
			noteRequest(error, options.method, path);
			throw error;
		})
	} as unknown as PocketBase;
}

beforeEach(async () => {
	problemLog.clear();
	await useContext(PC_CONTEXT);
});

afterEach(() => {
	document.body.innerHTML = '';
});

describe('RestartNeededNotice: the administrator at the PC (BW-2)', () => {
	// BYL-E6-2340
	it('names the way in the browser, offers „Jetzt neu starten“ and folds the files under „Notfall“', () => {
		// Worded once the context of the tab is known.
		const text = restartNeeded('Der Papierkorb ist');
		const { container } = render(RestartNoticeHarness, {
			props: { layout: restartStoreOf(), props: { text, place: 'notice:test' } }
		});
		expect(screen.getByText(text)).toBeTruthy();
		expect(text).toContain(RESTART_WAY);
		const button = screen.getByRole('button', { name: 'Jetzt neu starten' });
		expect(button.getAttribute('aria-disabled')).toBeNull();
		expect(button.getAttribute('aria-describedby')).toBeTruthy();
		expect(
			document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent
		).toBe('Startet becauseyoulovejira geordnet neu, wie auf der Seite „System“.');
		const summary = screen.getByText('Notfall: Neustart über den Ordner app');
		const emergency = summary.parentElement as HTMLDetailsElement;
		expect(emergency.tagName).toBe('DETAILS');
		expect(emergency.open).toBe(false);
		expect(emergency.textContent).toMatch(/neu-starten\.bat/);
		// Outside the fold the hint names no script.
		expect(outsideEmergency(container)).not.toMatch(/\.bat\b|\.ps1\b|\bsetx\b/);
	});

	// BYL-E6-2341
	it('asks like the page System, says what happens, waits for the server and reports the success', async () => {
		const data = fakeRestartData();
		const onrestarted = vi.fn();
		const { container } = render(RestartNoticeHarness, {
			props: {
				layout: restartStoreOf(data),
				props: { place: 'notice:test', live: true, onrestarted }
			}
		});
		// The live message stays a short status: the button and the run stand next to it.
		const live = container.querySelector('.section-message[role="status"]');
		expect(live?.textContent).toContain(RESTART_WAY);
		expect(live?.querySelector('button')).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Jetzt neu starten' }));
		const dialog = screen.getByRole('dialog', { name: 'becauseyoulovejira jetzt neu starten?' });
		expect(within(dialog).getByText(/Speichere vorher Eingaben in anderen Tabs/)).toBeTruthy();
		expect(within(dialog).getByText(/steht danach wieder hier/)).toBeTruthy();
		expect(data.act).not.toHaveBeenCalled();
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Neu starten' }));
		await vi.waitFor(() => expect(data.act).toHaveBeenCalledWith('restart', expect.anything()));
		await vi.waitFor(() =>
			expect(screen.getByText(/^becauseyoulovejira wurde neu gestartet\./)).toBeTruthy()
		);
		expect(data.health).toHaveBeenCalled();
		expect(onrestarted).toHaveBeenCalledTimes(1);
	});

	// BYL-E6-2342
	it('shows a refusal of the script as an error with „Details“ in the list of the session', async () => {
		const restart = new RestartStore(
			{
				status: async () => ok(restartOverview()),
				act: (action, options) => runSystemAction(failingClient(), action, options),
				health: async () => true
			},
			{ ensureValid: () => true, logout: vi.fn() },
			fakeRestartClock()
		);
		const onrestarted = vi.fn();
		const { container } = render(RestartNoticeHarness, {
			props: { layout: restart, props: { place: 'notice:test', onrestarted } }
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Jetzt neu starten' }));
		await fireEvent.click(
			within(
				screen.getByRole('dialog', { name: 'becauseyoulovejira jetzt neu starten?' })
			).getByRole('button', { name: 'Neu starten' })
		);
		await vi.waitFor(() =>
			expect(
				screen.getByRole('heading', { name: /Das Steuerskript hat nicht wie erwartet geantwortet/ })
			).toBeTruthy()
		);
		await fireEvent.click(screen.getByRole('button', { name: 'Details: App neu starten' }));
		expect(screen.getByText('POST /api/byl/system/actions/restart')).toBeTruthy();
		expect(problemLog.entries.map((entry) => entry.intent)).toContain('App neu starten');
		expect(onrestarted).not.toHaveBeenCalled();
		expect(outsideEmergency(container)).not.toMatch(/\.bat\b/);
	});

	// BYL-E6-2344
	it('locks the button without a connection and says why, but keeps it visible', async () => {
		const data = fakeRestartData();
		const outbox = { offline: true } as unknown as OutboxStore;
		render(RestartNoticeHarness, {
			props: { layout: restartStoreOf(data), outbox, props: { place: 'notice:test' } }
		});
		const button = screen.getByRole('button', { name: 'Jetzt neu starten' });
		expect(button.getAttribute('aria-disabled')).toBe('true');
		const described = (button.getAttribute('aria-describedby') ?? '')
			.split(' ')
			.map((id) => document.getElementById(id)?.textContent);
		expect(described[0]).toBe(
			'Nur mit Verbindung. Sobald die Verbindung zurück ist, geht es hier oder auf der Seite „Einstellungen → System“.'
		);
		await fireEvent.click(button);
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(data.status).not.toHaveBeenCalled();
		expect(data.act).not.toHaveBeenCalled();
	});

	// BYL-E6-2345
	it('takes the store of the page before the one of the layout, and without any only the emergency way', async () => {
		const layout = fakeRestartData();
		const page = fakeRestartData();
		const first = render(RestartNoticeHarness, {
			props: {
				layout: restartStoreOf(layout),
				props: { place: 'notice:test', restart: restartStoreOf(page) }
			}
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Jetzt neu starten' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Neu starten' }));
		await vi.waitFor(() => expect(page.act).toHaveBeenCalledWith('restart', expect.anything()));
		expect(layout.act).not.toHaveBeenCalled();
		await vi.waitFor(() =>
			expect(screen.getByText(/^becauseyoulovejira wurde neu gestartet\./)).toBeTruthy()
		);
		first.unmount();

		// Outside the (app) layout (no store): no button, the files only folded.
		render(RestartNeededNotice, { props: { place: 'notice:test' } });
		expect(screen.queryByRole('button', { name: 'Jetzt neu starten' })).toBeNull();
		expect(screen.getByText('Notfall: Neustart über den Ordner app')).toBeTruthy();
	});
});

describe('RestartNeededNotice: without the right (BW-2)', () => {
	// BYL-E6-2346
	it.each([
		[
			'the administrator on another device',
			REMOTE_CONTEXT,
			'Nur direkt am PC verfügbar, auf dem becauseyoulovejira läuft (dort über http://127.0.0.1:8090 öffnen). Dort: Einstellungen → System → „Jetzt neu starten“.'
		],
		[
			'another account',
			MEMBER_CONTEXT,
			'Neu starten kann nur der Verwalter unter Einstellungen → System. Bitte den Verwalter fragen.'
		]
	])('gives %s no button, only who restarts where', async (_who, context, way) => {
		await useContext(context);
		const data = fakeRestartData();
		const { container } = render(RestartNoticeHarness, {
			props: { layout: restartStoreOf(data), props: { place: 'notice:test' } }
		});
		expect(screen.queryByRole('button', { name: 'Jetzt neu starten' })).toBeNull();
		expect(container.textContent).toContain(way);
		expect(container.querySelector('details')).toBeNull();
		expect(container.textContent).not.toMatch(/\.bat\b|\.ps1\b|\bsetx\b/);
		expect(data.status).not.toHaveBeenCalled();
	});

	// BYL-E6-2347
	it('gives a server that is not Windows and a tab without its context only the sentence', async () => {
		for (const context of [LINUX_CONTEXT, 'outdated', 'pending'] as const) {
			await useContext(context);
			const { container, unmount } = render(RestartNoticeHarness, {
				props: { layout: restartStoreOf(), props: { place: 'notice:test' } }
			});
			expect(screen.queryByRole('button', { name: 'Jetzt neu starten' })).toBeNull();
			expect(container.textContent).toContain(
				'Die App hat ein Update bekommen, das erst nach einem Neustart wirkt.'
			);
			expect(container.textContent).not.toMatch(/\.bat\b|„Jetzt neu starten“/);
			unmount();
		}
	});
});
