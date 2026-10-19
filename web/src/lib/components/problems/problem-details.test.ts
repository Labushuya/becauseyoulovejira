// "Details" of the message of a failed action (FP-1, ADR-0071): folded row, the facts, "Kopieren"
// with "Kopiert.", the fallback when the browser refuses, the technical details of an exception,
// "Alle Fehler dieser Sitzung (n)" (dialog outside a modal, embedded inside one) and the entry in
// the list of the session, once. Also the building blocks that carry it: SectionMessage, Field,
// ConfirmDialog and the flags.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SectionMessage from '$lib/components/guidance/SectionMessage.svelte';
import ConfirmDialog from '$lib/components/overlay/ConfirmDialog.svelte';
import FlagGroup from '$lib/components/overlay/FlagGroup.svelte';
import {
	clientProblem,
	problemReport,
	type ProblemEntry,
	type ProblemInput
} from '$lib/domain/problems';
import { FlagStore } from '$lib/stores/flags.svelte';
import { problemLog } from '$lib/stores/problem-log.svelte';
import FieldHarness from '$lib/test/FieldHarness.svelte';
import InModalHarness from '$lib/test/InModalHarness.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import ProblemDetails from './ProblemDetails.svelte';

useOverlayStubs();

const AT = Date.UTC(2026, 9, 19, 12, 3, 12);

function problem(overrides: Partial<ProblemInput> = {}): ProblemEntry {
	return clientProblem({
		id: `p-${Math.random().toString(36).slice(2)}`,
		intent: 'Unteraufgaben übertragen',
		at: AT,
		outcome: { result: 'response', status: 409, code: null, message: 'Inzwischen geändert.' },
		request: { method: 'POST', path: '/api/byl/tickets/abc123def456789/subtasks/transfer' },
		app: '1792421233406',
		exception: null,
		...overrides
	});
}

function text(element: Element): string {
	return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
}

beforeEach(() => {
	problemLog.clear();
	problemLog.closeDialog();
});

afterEach(() => vi.unstubAllGlobals());

describe('the row "Details"', () => {
	it('is folded, unfolds with aria-expanded and shows the facts', async () => {
		render(ProblemDetails, { props: { problem: problem() } });
		const toggle = screen.getByRole('button', { name: 'Details: Unteraufgaben übertragen' });
		expect(toggle.getAttribute('aria-expanded')).toBe('false');
		expect(screen.queryByText('Absicht')).toBeNull();

		await fireEvent.click(toggle);

		expect(toggle.getAttribute('aria-expanded')).toBe('true');
		const panel = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
		expect(panel).not.toBeNull();
		const facts = text(panel as HTMLElement);
		expect(facts).toContain('Absicht Unteraufgaben übertragen');
		expect(facts).toContain('Zeitpunkt 19.10.2026, 14:03:12');
		expect(facts).toContain('Ergebnis HTTP 409 (Konflikt)');
		expect(facts).toContain('Servermeldung Inzwischen geändert.');
		expect(facts).toContain('Anfrage POST /api/byl/tickets/abc123def456789/subtasks/transfer');
		expect(facts).toContain('App-Stand Build 1792421233406');
		expect(screen.queryByRole('button', { name: /Technische Details/ })).toBeNull();
	});

	it('copies the report and says "Kopiert."', async () => {
		const writeText = vi.fn(async () => undefined);
		vi.stubGlobal('navigator', { clipboard: { writeText } });
		const entry = problem();
		render(ProblemDetails, { props: { problem: entry } });
		await fireEvent.click(screen.getByRole('button', { name: /^Details/ }));

		await fireEvent.click(screen.getByRole('button', { name: 'Kopieren' }));
		await tick();

		expect(writeText).toHaveBeenCalledWith(problemReport(entry));
		expect(screen.getByRole('button', { name: 'Kopiert.' })).not.toBeNull();
		expect(screen.getByRole('status').textContent).toBe('Kopiert.');
	});

	it('shows and selects the report when the browser refuses the clipboard', async () => {
		vi.stubGlobal('navigator', {
			clipboard: {
				writeText: async () => {
					throw new DOMException('denied', 'NotAllowedError');
				}
			}
		});
		const entry = problem();
		render(ProblemDetails, { props: { problem: entry } });
		await fireEvent.click(screen.getByRole('button', { name: /^Details/ }));

		await fireEvent.click(screen.getByRole('button', { name: 'Kopieren' }));
		await tick();
		await tick();

		expect(screen.getByRole('status').textContent).toMatch(/Strg\+C/);
		const fallback = screen.getByText((_content, element) => element?.tagName === 'PRE');
		expect(fallback.textContent).toBe(problemReport(entry));
		expect(window.getSelection()?.toString()).toBe(problemReport(entry));
	});

	it('folds the technical details of an unexpected exception below', async () => {
		render(ProblemDetails, {
			props: {
				problem: problem({
					intent: 'Unerwarteter Fehler',
					outcome: { result: 'exception', status: null, code: null, message: null },
					request: null,
					exception: {
						name: 'TypeError',
						message: 'x is undefined',
						stack: ['at f (/_app/a.js:1:2)']
					}
				})
			}
		});
		await fireEvent.click(screen.getByRole('button', { name: /^Details/ }));
		const technical = screen.getByRole('button', { name: 'Technische Details' });
		expect(technical.getAttribute('aria-expanded')).toBe('false');

		await fireEvent.click(technical);

		expect(technical.getAttribute('aria-expanded')).toBe('true');
		const block = document.getElementById(technical.getAttribute('aria-controls') ?? '');
		expect(block?.textContent).toBe('TypeError: x is undefined\n  at f (/_app/a.js:1:2)');
		expect(text(document.body)).not.toContain('Anfrage');
	});

	it('takes its entry into the list once and links it with the number', async () => {
		const entry = problem();
		problemLog.record(problem({ id: 'older', intent: 'Ticket speichern', at: AT - 60_000 }));
		const view = render(ProblemDetails, { props: { problem: entry } });
		await tick();
		view.rerender({ problem: entry });
		await tick();
		expect(problemLog.entries.map((item) => item.id)).toEqual([entry.id, 'older']);

		await fireEvent.click(screen.getByRole('button', { name: /^Details/ }));
		const all = screen.getByRole('button', { name: 'Alle Fehler dieser Sitzung (2)' });
		expect(all.getAttribute('aria-haspopup')).toBe('dialog');
		await fireEvent.click(all);

		expect(problemLog.dialogOpen).toBe(true);
	});

	it('renders nothing without an entry', () => {
		const { container } = render(ProblemDetails, { props: { problem: null } });
		expect(container.querySelector('[data-problem-details]')).toBeNull();
		expect(problemLog.count).toBe(0);
	});

	it('unfolds the list in place inside a modal, no dialog from a dialog', async () => {
		problemLog.record(problem({ intent: 'Ticket speichern', at: AT - 60_000 }));
		render(InModalHarness, { props: { component: ProblemDetails, props: { problem: problem() } } });
		await tick();
		const modal = screen.getByRole('dialog', { name: 'Vollansicht' });
		await fireEvent.click(within(modal).getByRole('button', { name: /^Details/ }));
		const all = within(modal).getByRole('button', { name: 'Alle Fehler dieser Sitzung (2)' });
		expect(all.getAttribute('aria-expanded')).toBe('false');

		await fireEvent.click(all);
		await tick();

		expect(all.getAttribute('aria-expanded')).toBe('true');
		expect(problemLog.dialogOpen).toBe(false);
		const area = within(modal).getByRole('region', { name: 'Fehler dieser Sitzung' });
		expect(within(area).getAllByRole('listitem')).toHaveLength(2);
	});
});

describe('building blocks with "Details"', () => {
	const message = createRawSnippet(() => ({ render: () => '<span>Nicht übertragen.</span>' }));

	it('SectionMessage shows the row for an error with an entry, not for other tones', () => {
		const { container, unmount } = render(SectionMessage, {
			props: { tone: 'error', live: true, problem: problem(), children: message }
		});
		const alert = screen.getByRole('alert');
		expect(within(alert).getByRole('button', { name: /^Details/ })).not.toBeNull();
		unmount();

		render(SectionMessage, { props: { tone: 'warning', problem: problem(), children: message } });
		expect(container.querySelector('[data-problem-details]')).toBeNull();
		render(SectionMessage, { props: { tone: 'error', children: message } });
		expect(document.querySelector('[data-problem-details]')).toBeNull();
	});

	it('a field shows the row below the error of a failed save', async () => {
		render(FieldHarness, {
			props: { label: 'Titel', error: 'Server nicht erreichbar.', problem: problem() }
		});
		const error = screen.getByText('Server nicht erreichbar.');
		const details = error.closest('.field-error')?.nextElementSibling;
		expect(details?.hasAttribute('data-problem-details')).toBe(true);
	});

	it('the confirmation shows the row below its failure', async () => {
		render(ConfirmDialog, {
			props: {
				open: true,
				title: 'Papierkorb leeren?',
				confirmLabel: 'Leeren',
				error: 'Der Server hat mit einem Fehler geantwortet.',
				problem: problem({ intent: 'Papierkorb leeren' }),
				onconfirm: () => undefined,
				oncancel: () => undefined,
				children: message
			}
		});
		await tick();
		const dialog = screen.getByRole('dialog', { hidden: true, name: 'Papierkorb leeren?' });
		expect(
			within(dialog).getByRole('button', { hidden: true, name: 'Details: Papierkorb leeren' })
		).not.toBeNull();
	});

	it('an error flag ends with the row; success and info never have one', async () => {
		const flags = new FlagStore();
		render(FlagGroup, { props: { store: flags } });
		flags.show({ tone: 'success', title: 'Gespeichert.', problem: problem() });
		flags.show({ tone: 'error', title: 'HAUS-12 nicht gespeichert.', problem: problem() });
		await tick();
		const [error, success] = screen.getAllByRole('listitem') as HTMLElement[];
		expect(within(error as HTMLElement).getByRole('button', { name: /^Details/ })).not.toBeNull();
		expect(within(success as HTMLElement).queryByRole('button', { name: /^Details/ })).toBeNull();
		expect(flags.flags[1]?.problem).toBeNull();
	});
});
