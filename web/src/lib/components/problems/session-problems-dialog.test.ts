// Dialog "Fehler dieser Sitzung" (FP-1, ADR-0071 §4): the list newest first with intent, time,
// short result and "3×", each entry unfolding to its details, "Alle kopieren", "Liste leeren" with
// the empty state and the focus there, a named modal with "Schließen", and the lasting entry of
// the page "Hilfe".

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	clientProblem,
	problemReport,
	problemsReport,
	type ProblemEntry,
	type ProblemInput
} from '$lib/domain/problems';
import { problemLog } from '$lib/stores/problem-log.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import SessionProblemsDialog from './SessionProblemsDialog.svelte';
import SessionProblemsEntry from './SessionProblemsEntry.svelte';

useOverlayStubs();

const AT = Date.UTC(2026, 9, 19, 12, 3, 12);
let counter = 0;

function problem(overrides: Partial<ProblemInput> = {}): ProblemEntry {
	counter += 1;
	return clientProblem({
		id: `dialog-${counter}`,
		intent: 'Ticket speichern',
		at: AT,
		outcome: { result: 'network', status: null, code: null, message: null },
		request: { method: 'PATCH', path: '/api/collections/tickets/records/abc123def456789' },
		app: null,
		exception: null,
		...overrides
	});
}

function text(element: Element): string {
	return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
}

async function openDialog() {
	const onclose = vi.fn();
	render(SessionProblemsDialog, { props: { onclose } });
	await tick();
	await tick();
	const dialog = screen.getByRole('dialog', { name: 'Fehler dieser Sitzung' });
	return { dialog, onclose };
}

beforeEach(() => problemLog.clear());
afterEach(() => vi.unstubAllGlobals());

describe('dialog "Fehler dieser Sitzung"', () => {
	it('lists the entries newest first with intent, time, result and the number of repeats', async () => {
		problemLog.record(problem({ intent: 'Ticket speichern', at: AT - 120_000 }));
		problemLog.record(
			problem({
				intent: 'Kanal jetzt abrufen',
				at: AT,
				outcome: { result: 'response', status: 503, code: 'missing', message: null },
				request: { method: 'POST', path: '/api/byl/connections/conn00000000001/run' }
			})
		);
		problemLog.record(
			problem({
				intent: 'Kanal jetzt abrufen',
				at: AT + 4000,
				outcome: { result: 'response', status: 503, code: 'missing', message: null },
				request: { method: 'POST', path: '/api/byl/connections/conn00000000001/run' }
			})
		);
		const { dialog } = await openDialog();

		const list = within(dialog).getByRole('list', { name: 'Fehler dieser Sitzung' });
		const items = within(list).getAllByRole('listitem');
		expect(items.map(text)).toEqual([
			'Kanal jetzt abrufen 2× 19.10.2026, 14:03:16 · HTTP 503 (Nicht verfügbar) Details: Kanal jetzt abrufen, 19.10.2026, 14:03:16',
			'Ticket speichern 19.10.2026, 14:01:12 · Keine Verbindung zum Server Details: Ticket speichern, 19.10.2026, 14:01:12'
		]);
	});

	it('unfolds an entry to its details and copies its report', async () => {
		const writeText = vi.fn(async () => undefined);
		vi.stubGlobal('navigator', { clipboard: { writeText } });
		problemLog.record(problem());
		const { dialog } = await openDialog();
		const toggle = within(dialog).getByRole('button', { name: /^Details: Ticket speichern/ });
		expect(toggle.getAttribute('aria-expanded')).toBe('false');

		await fireEvent.click(toggle);

		expect(toggle.getAttribute('aria-expanded')).toBe('true');
		const panel = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
		expect(text(panel as HTMLElement)).toContain(
			'Anfrage PATCH /api/collections/tickets/records/abc123def456789'
		);
		await fireEvent.click(within(panel as HTMLElement).getByRole('button', { name: 'Kopieren' }));
		await tick();
		expect(writeText).toHaveBeenCalledWith(problemReport(problemLog.entries[0] as ProblemEntry));
		expect(within(panel as HTMLElement).getByRole('button', { name: 'Kopiert.' })).not.toBeNull();
	});

	it('copies every report with "Alle kopieren"', async () => {
		const writeText = vi.fn(async () => undefined);
		vi.stubGlobal('navigator', { clipboard: { writeText } });
		problemLog.record(problem({ at: AT - 60_000 }));
		problemLog.record(problem({ intent: 'Ticket anlegen' }));
		const { dialog } = await openDialog();

		await fireEvent.click(within(dialog).getByRole('button', { name: 'Alle kopieren' }));
		await tick();

		expect(writeText).toHaveBeenCalledWith(problemsReport(problemLog.entries));
		expect(within(dialog).getByRole('button', { name: 'Alle kopiert.' })).not.toBeNull();
	});

	it('empties the list, says so and moves the focus to the empty list', async () => {
		problemLog.record(problem());
		const { dialog } = await openDialog();

		await fireEvent.click(within(dialog).getByRole('button', { name: 'Liste leeren' }));
		await tick();

		expect(problemLog.count).toBe(0);
		const empty = within(dialog).getByText('In dieser Sitzung ist kein Fehler aufgetreten.');
		expect(document.activeElement).toBe(empty);
		const statuses = within(dialog).getAllByRole('status');
		expect(statuses.map((status) => status.textContent)).toContain('Liste geleert.');
		expect(within(dialog).queryByRole('button', { name: 'Alle kopieren' })).toBeNull();
	});

	it('shows the empty state and closes with "Schließen"', async () => {
		const { dialog, onclose } = await openDialog();

		const empty = within(dialog).getByText('In dieser Sitzung ist kein Fehler aufgetreten.');
		expect(empty).not.toBeNull();
		expect(within(dialog).queryByRole('list')).toBeNull();
		// The footer button; the × of the head has the same name.
		await fireEvent.click(within(dialog).getByText('Schließen'));
		expect(onclose).toHaveBeenCalled();
	});
});

describe('entry on the page "Hilfe"', () => {
	it('opens the dialog of the list with its number', async () => {
		problemLog.closeDialog();
		problemLog.record(problem());
		render(SessionProblemsEntry);
		const button = screen.getByRole('button', { name: 'Fehler dieser Sitzung anzeigen (1)' });
		expect(button.getAttribute('aria-haspopup')).toBe('dialog');

		await fireEvent.click(button);

		expect(problemLog.dialogOpen).toBe(true);
		problemLog.closeDialog();
	});
});
