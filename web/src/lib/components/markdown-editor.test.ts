// Component tests for the Markdown editor and display (ADR-0008 point 4): switch between writing
// and preview, character limit, label.

import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Markdown from './Markdown.svelte';
import MarkdownEditor from './MarkdownEditor.svelte';

function textarea() {
	return screen.getByLabelText<HTMLTextAreaElement>('Beschreibung');
}

function modeButton(name: 'Schreiben' | 'Vorschau') {
	return screen.getByRole('button', { name });
}

describe('markdown editor', () => {
	it('labels the text field and sets the character limit', () => {
		render(MarkdownEditor, { props: { value: '', label: 'Beschreibung', maxlength: 100 } });

		expect(textarea().tagName).toBe('TEXTAREA');
		expect(textarea().maxLength).toBe(100);
		expect(modeButton('Schreiben').getAttribute('aria-pressed')).toBe('true');
		expect(modeButton('Vorschau').getAttribute('aria-pressed')).toBe('false');
	});

	it('switches to the rendered preview and back', async () => {
		render(MarkdownEditor, {
			props: { value: '**fett** <b>roh</b>', label: 'Beschreibung', maxlength: 100 }
		});

		await fireEvent.click(modeButton('Vorschau'));
		const preview = screen.getByRole('region', { name: 'Beschreibung: Vorschau' });
		expect(preview.querySelector('strong')?.textContent).toBe('fett');
		expect(preview.querySelector('b')).toBeNull();
		expect(textarea().hidden).toBe(true);
		expect(modeButton('Vorschau').getAttribute('aria-pressed')).toBe('true');

		await fireEvent.click(modeButton('Schreiben'));
		expect(screen.queryByRole('region', { name: 'Beschreibung: Vorschau' })).toBeNull();
		expect(textarea().hidden).toBe(false);
		expect(textarea().value).toBe('**fett** <b>roh</b>');
	});

	it('shows a hint for an empty preview', async () => {
		render(MarkdownEditor, { props: { value: '  ', label: 'Beschreibung', maxlength: 100 } });

		await fireEvent.click(modeButton('Vorschau'));

		expect(screen.getByText('Nichts zu zeigen.')).toBeTruthy();
	});

	it('shows the character count near the limit and links it to the field', async () => {
		render(MarkdownEditor, {
			props: { value: '', label: 'Beschreibung', maxlength: 10, 'aria-describedby': 'fehler' }
		});
		expect(screen.queryByText(/Zeichen$/)).toBeNull();
		expect(textarea().getAttribute('aria-describedby')).toBe('fehler');

		await fireEvent.input(textarea(), { target: { value: '123456789' } });

		const counter = screen.getByText('9 von 10 Zeichen');
		expect(textarea().getAttribute('aria-describedby')).toBe(`fehler ${counter.id}`);
	});

	it('passes further attributes to the text field', () => {
		render(MarkdownEditor, {
			props: { value: '', label: 'Beschreibung', maxlength: 10, 'aria-invalid': 'true' }
		});

		expect(textarea().getAttribute('aria-invalid')).toBe('true');
	});
});

describe('markdown display', () => {
	it('renders sanitized Markdown', () => {
		const { container } = render(Markdown, {
			props: { source: '# Hallo\n\n<script>alert(1)</script>' }
		});

		expect(container.querySelector('h1')?.textContent).toBe('Hallo');
		expect(container.querySelector('script')).toBeNull();
		expect(container.textContent).toContain('<script>alert(1)</script>');
	});
});
