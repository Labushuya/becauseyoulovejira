// The access data on the page "Kanäle" (BW-3, ADR-0075): every card with variables holds
// "Zugangsdaten" in its details and leads there from its menu, "‹Name› bearbeiten" shows the same
// fields, the lasting hint stands above the cards (at the PC with "Jetzt neu starten", on another
// device with who restarts where), and the setup assistant sets its variable in the browser with
// setx only folded under „Notfall“. The data layers are fakes; stores and building blocks are real.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { Connection } from '$lib/domain/connections';
import { CREDENTIAL_TEXTS, PC_ONLY } from '$lib/domain/credentials';
import ChannelsViewHarness from '$lib/test/ChannelsViewHarness.svelte';
import { connectionOf, connectionsStoreOf, fakeConnectionsData } from '$lib/test/connections-fake';
import { PC_CONTEXT, REMOTE_CONTEXT, useContext } from '$lib/test/context';
import {
	credentialsStoreOf,
	fakeCredentialsData,
	variableOf,
	type FakeCredentialsData
} from '$lib/test/credentials-fake';
import { useOverlayStubs } from '$lib/test/overlay-stubs';

useOverlayStubs();

const CALENDAR = connectionOf({
	id: 'conn00000000011',
	label: 'Google Kalender',
	secretEnv: 'BYL_GOOGLE_CALENDAR_URL',
	lastRunAt: '2026-10-30 08:00:00.000Z',
	keywords: ['todo']
});

async function renderPage(
	items: Connection[],
	data: FakeCredentialsData,
	setup: { kind: 'kalender' | 'webde'; connectionId: string | null } | null = null
) {
	const connections = await connectionsStoreOf(
		fakeConnectionsData(items, { secret: true, allowlist: null }).data
	);
	const credentials = credentialsStoreOf(data);
	render(ChannelsViewHarness, { props: { connections, credentials, setup, onchange: vi.fn() } });
	await tick();
	await tick();
	return { connections, credentials };
}

async function chooseFromMenu(name: string, entry: string) {
	const trigger = screen.getByRole('button', { name: `Weitere Aktionen für ${name}` });
	await fireEvent.click(trigger);
	const menu = document.getElementById(trigger.getAttribute('aria-controls') ?? '');
	await fireEvent.click(
		within(menu as HTMLElement).getByRole('menuitem', { name: entry, hidden: true })
	);
}

beforeEach(async () => {
	sessionStorage.clear();
	localStorage.clear();
	await useContext(PC_CONTEXT);
});

afterEach(() => {
	document.body.innerHTML = '';
});

describe('the cards of the page "Kanäle"', () => {
	it('lead from the menu "Zugangsdaten …" to the fields in the details, with the state read at the PC', async () => {
		const data = fakeCredentialsData([
			variableOf('BYL_GOOGLE_CALENDAR_URL', { set: false, channels: ['Google Kalender'] })
		]);
		await renderPage([CALENDAR], data);
		await vi.waitFor(() => expect(data.status).toHaveBeenCalled());
		await chooseFromMenu('Google Kalender', 'Zugangsdaten …');
		const heading = await vi.waitFor(() => screen.getByRole('heading', { name: 'Zugangsdaten' }));
		await vi.waitFor(() => expect(document.activeElement).toBe(heading));
		const group = screen.getByRole('group', { name: 'BYL_GOOGLE_CALENDAR_URL' });
		expect(within(group).getByText('fehlt')).toBeTruthy();
		expect(within(group).getByRole('button', { name: 'Setzen …' })).toBeTruthy();
	});

	it('show the same fields in "‹Name› bearbeiten"', async () => {
		const data = fakeCredentialsData([variableOf('BYL_GOOGLE_CALENDAR_URL')]);
		await renderPage([CALENDAR], data);
		await chooseFromMenu('Google Kalender', 'Stichwörter und Einstellungen …');
		const modal = await vi.waitFor(() =>
			screen.getByRole('dialog', { name: 'Google Kalender bearbeiten' })
		);
		const group = within(modal).getByRole('group', { name: 'BYL_GOOGLE_CALENDAR_URL' });
		expect(within(group).getByText('gesetzt')).toBeTruthy();
		expect(within(group).getByRole('button', { name: 'Ersetzen …' })).toBeTruthy();
	});
});

describe('the lasting hint "Neustart nötig" (V3)', () => {
	it('stands above the cards while the server names it, with "Jetzt neu starten" at the PC', async () => {
		const data = fakeCredentialsData([variableOf('BYL_GOOGLE_CALENDAR_URL')], true);
		await renderPage([CALENDAR], data);
		await vi.waitFor(() => expect(screen.getByText(CREDENTIAL_TEXTS.pendingRestart)).toBeTruthy());
		const hint = screen
			.getByText(CREDENTIAL_TEXTS.pendingRestart)
			.closest('[data-tone]') as HTMLElement;
		expect(hint.getAttribute('data-tone')).toBe('warning');
		expect(within(hint).getByRole('button', { name: 'Jetzt neu starten' })).toBeTruthy();
		// The server restarted elsewhere: the tab asks again when it comes back.
		data.restarted();
		document.dispatchEvent(new Event('visibilitychange'));
		await vi.waitFor(() => expect(screen.queryByText(CREDENTIAL_TEXTS.pendingRestart)).toBeNull());
	});

	it('stands on another device too, without the state of the variables and with "Nur am PC möglich"', async () => {
		await useContext(REMOTE_CONTEXT);
		const data = fakeCredentialsData([variableOf('BYL_GOOGLE_CALENDAR_URL')], true);
		await renderPage([CALENDAR], data);
		await vi.waitFor(() => expect(screen.getByText(CREDENTIAL_TEXTS.pendingRestart)).toBeTruthy());
		expect(data.notice).toHaveBeenCalled();
		expect(data.status).not.toHaveBeenCalled();
		await chooseFromMenu('Google Kalender', 'Zugangsdaten …');
		const group = await vi.waitFor(() =>
			screen.getByRole('group', { name: 'BYL_GOOGLE_CALENDAR_URL' })
		);
		expect(within(group).getAllByText(PC_ONLY).length).toBeGreaterThan(0);
		expect(
			within(group).getByRole('button', { name: 'Setzen …' }).getAttribute('aria-disabled')
		).toBe('true');
	});
});

describe('a change without an answer (S6)', () => {
	it('says that it is unclear whether it arrived and reads the state again once the connection is back', async () => {
		const data = fakeCredentialsData([
			variableOf('BYL_GOOGLE_CALENDAR_URL', { set: false, channels: ['Google Kalender'] })
		]);
		// The change reaches the server, but its answer is lost on the way back.
		const arrives = data.set.getMockImplementation();
		data.set.mockImplementationOnce(async (name, value) => {
			await arrives?.(name, value);
			throw new DataError('network', { status: 0 });
		});
		await renderPage([CALENDAR], data);
		await vi.waitFor(() => expect(data.status).toHaveBeenCalled());
		const asked = data.status.mock.calls.length;
		// Without such a change, coming back reads nothing again.
		window.dispatchEvent(new Event('online'));
		await tick();
		expect(data.status).toHaveBeenCalledTimes(asked);

		await chooseFromMenu('Google Kalender', 'Zugangsdaten …');
		const group = await vi.waitFor(() =>
			screen.getByRole('group', { name: 'BYL_GOOGLE_CALENDAR_URL' })
		);
		await fireEvent.click(within(group).getByRole('button', { name: 'Setzen …' }));
		await tick();
		await fireEvent.input(within(group).getByLabelText('Neuer Wert für BYL_GOOGLE_CALENDAR_URL'), {
			target: { value: 'https://example.com/kalender/basic.ics' }
		});
		await fireEvent.click(within(group).getByRole('button', { name: 'Speichern' }));
		await vi.waitFor(() => expect(within(group).getByText(CREDENTIAL_TEXTS.offline)).toBeTruthy());
		expect(CREDENTIAL_TEXTS.offline).toBe(
			'Verbindung unterbrochen – ob die Änderung angekommen ist, ist unklar. Im Browser wurde nichts gespeichert. Der Zustand wird nach dem Wiederverbinden neu geladen.'
		);
		expect(within(group).getByText('fehlt')).toBeTruthy();

		// Back online: the state is read again and shows that the change did arrive.
		window.dispatchEvent(new Event('online'));
		await vi.waitFor(() => expect(within(group).getByText('gesetzt')).toBeTruthy());
		expect(data.status).toHaveBeenCalledTimes(asked + 1);
		expect(data.set).toHaveBeenCalledTimes(1);
		// Read once, a later return asks nothing more.
		document.dispatchEvent(new Event('visibilitychange'));
		await tick();
		expect(data.status).toHaveBeenCalledTimes(asked + 1);
	});
});

describe('the setup assistant (decision 1: also the name it suggests)', () => {
	it('sets the variable of the step in the browser and folds setx under „Notfall“', async () => {
		const data = fakeCredentialsData();
		await renderPage([], data, { kind: 'webde', connectionId: null });
		const dialog = screen.getByRole('dialog', { name: 'Web.de einrichten' });
		await fireEvent.click(within(dialog).getByRole('button', { name: /Variable setzen/ }));
		await tick();
		const group = await vi.waitFor(() =>
			within(dialog).getByRole('group', { name: 'BYL_WEBDE_PASSWORD' })
		);
		// The suggested name of the step is asked for before the connection exists.
		await vi.waitFor(() =>
			expect(data.status).toHaveBeenCalledWith(['BYL_WEBDE_PASSWORD'], expect.anything())
		);
		expect(within(group).getByRole('button', { name: 'Setzen …' })).toBeTruthy();
		const summary = within(dialog).getByText(CREDENTIAL_TEXTS.setupEmergencySummary);
		const emergency = summary.parentElement as HTMLDetailsElement;
		expect(emergency.tagName).toBe('DETAILS');
		expect(emergency.open).toBe(false);
		expect(emergency.textContent).toMatch(/setx/);
		// Outside the fold the step names no command.
		const step = group.closest('section') as HTMLElement;
		const copy = step.cloneNode(true) as HTMLElement;
		for (const details of copy.querySelectorAll('details')) details.remove();
		expect(copy.textContent).not.toMatch(/setx/);
	});
});
