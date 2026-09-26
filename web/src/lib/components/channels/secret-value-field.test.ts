// Component tests of "Wert hier einsetzen" (user decision 2, ADR-0026 sections 5 and 10, plan EH-5
// §3.13): folded, a password field with "Anzeigen" and attributes against spell check and password
// managers, the hint on the clipboard history (Win+V), a masked preview, and the proof that the
// value stays local: it never reaches the data layer, never lands in web storage and is gone from
// the DOM after copying and after closing.

import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SECRET_MASK } from '$lib/guidance/command';
import SecretValueField from './SecretValueField.svelte';

const SECRET = 'https://calendar.google.com/calendar/ical/geheim-4711/basic.ics';
const PROPS = {
	label: 'Befehl für die Eingabeaufforderung',
	template: 'setx {{variable}} "{{wert}}"',
	placeholders: {
		variable: { label: 'Variable', secret: false },
		wert: { label: 'iCal-Adresse', secret: true }
	},
	name: 'wert',
	fixed: { variable: 'BYL_GOOGLE_CALENDAR_URL' }
};

let fetchSpy: ReturnType<typeof vi.fn>;
let consoleSpies: ReturnType<typeof vi.spyOn>[];

beforeEach(() => {
	localStorage.clear();
	sessionStorage.clear();
	fetchSpy = vi.fn();
	vi.stubGlobal('fetch', fetchSpy);
	consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
		vi.spyOn(console, method)
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
	for (const spy of consoleSpies) spy.mockRestore();
	document.body.innerHTML = '';
});

function storageHolds(value: string): boolean {
	const all = [localStorage, sessionStorage].flatMap((storage) =>
		Object.keys(storage).map((key) => `${key}=${storage.getItem(key)}`)
	);
	return all.some((entry) => entry.includes(value));
}

async function open() {
	const view = render(SecretValueField, { props: PROPS });
	const details = document.querySelector('details') as HTMLDetailsElement;
	details.open = true;
	await fireEvent(details, new Event('toggle'));
	const field = screen.getByLabelText('iCal-Adresse') as HTMLInputElement;
	return { view, details, field };
}

async function type(field: HTMLInputElement, value: string) {
	await fireEvent.input(field, { target: { value } });
	await tick();
}

describe('secret value field', () => {
	it('is folded with a password field that is not spell checked or remembered', async () => {
		render(SecretValueField, { props: PROPS });
		const details = document.querySelector('details') as HTMLDetailsElement;
		expect(details.open).toBe(false);
		expect(details.querySelector('summary')?.textContent).toBe(
			'Wert hier einsetzen (bleibt in diesem Browserfenster)'
		);

		details.open = true;
		await fireEvent(details, new Event('toggle'));
		const field = screen.getByLabelText('iCal-Adresse') as HTMLInputElement;
		expect(field.type).toBe('password');
		expect(field.getAttribute('autocomplete')).toBe('off');
		expect(field.getAttribute('spellcheck')).toBe('false');
		expect(field.getAttribute('autocapitalize')).toBe('off');
		expect(field.hasAttribute('data-1p-ignore')).toBe(true);
		expect(field.getAttribute('data-lpignore')).toBe('true');
		expect(field.getAttribute('name')).not.toMatch(/pass|secret|url|token/i);
		expect(screen.getByText(/Zwischenablage-Verlauf \(Win\+V\)/)).toBeTruthy();
		expect(field.getAttribute('aria-describedby')).toBeTruthy();
	});

	it('shows the value only on "Anzeigen" and masks it in the preview', async () => {
		const { field } = await open();
		await type(field, SECRET);

		const show = screen.getByRole('button', { name: 'Anzeigen' });
		expect(show.getAttribute('aria-pressed')).toBe('false');
		await fireEvent.click(show);
		expect(field.type).toBe('text');
		expect(show.getAttribute('aria-pressed')).toBe('true');

		const preview = screen.getByRole('region', {
			name: 'Befehl für die Eingabeaufforderung mit deinem Wert'
		});
		expect(preview.textContent).toBe(`setx BYL_GOOGLE_CALENDAR_URL "${SECRET_MASK}"`);
		expect(document.body.innerHTML).not.toContain(SECRET);
	});

	it('refuses quotes for setx and offers no command then', async () => {
		const { field } = await open();
		await type(field, 'a"b');
		expect(screen.getByText(/Anführungszeichen gehen mit setx nicht/)).toBeTruthy();
		expect(field.getAttribute('aria-invalid')).toBe('true');
		expect(screen.queryByRole('region', { name: /mit deinem Wert/ })).toBeNull();
	});

	it('copies the finished command and empties the field; nothing is sent, stored or logged', async () => {
		const writeText = vi.fn(async () => undefined);
		vi.stubGlobal('navigator', { clipboard: { writeText } });
		const { field } = await open();
		await type(field, SECRET);

		await fireEvent.click(
			screen.getByRole('button', {
				name: 'Befehl für die Eingabeaufforderung mit deinem Wert kopieren'
			})
		);
		await vi.waitFor(() => expect(field.value).toBe(''));
		expect(writeText).toHaveBeenCalledWith(`setx BYL_GOOGLE_CALENDAR_URL "${SECRET}"`);
		expect(storageHolds(SECRET)).toBe(false);
		expect(fetchSpy).not.toHaveBeenCalled();
		for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
		expect(document.body.innerHTML).not.toContain(SECRET);
		expect(screen.queryByRole('region', { name: /mit deinem Wert/ })).toBeNull();
	});

	it('forgets the value when the fold closes and when the field goes away', async () => {
		const { view, details, field } = await open();
		await type(field, SECRET);

		details.open = false;
		await fireEvent(details, new Event('toggle'));
		details.open = true;
		await fireEvent(details, new Event('toggle'));
		expect((screen.getByLabelText('iCal-Adresse') as HTMLInputElement).value).toBe('');

		await type(screen.getByLabelText('iCal-Adresse') as HTMLInputElement, SECRET);
		view.unmount();
		expect(document.body.innerHTML).not.toContain(SECRET);
		expect(storageHolds(SECRET)).toBe(false);
	});

	it('uses an open text field without the history hint for values that are no secret', async () => {
		render(SecretValueField, {
			props: {
				...PROPS,
				placeholders: { ...PROPS.placeholders, wert: { label: 'Chat-IDs', secret: false } }
			}
		});
		const details = document.querySelector('details') as HTMLDetailsElement;
		details.open = true;
		await fireEvent(details, new Event('toggle'));
		const field = screen.getByLabelText('Chat-IDs') as HTMLInputElement;
		expect(field.type).toBe('text');
		expect(screen.queryByRole('button', { name: 'Anzeigen' })).toBeNull();
		expect(screen.queryByText(/Win\+V/)).toBeNull();
		await type(field, '424242');
		expect(screen.getByRole('region', { name: /mit deinem Wert/ }).textContent).toBe(
			'setx BYL_GOOGLE_CALENDAR_URL "424242"'
		);
	});
});
