// When the chunk of the editor cannot be loaded (ADR-0032 section 5, plan editor section 3.2),
// the textarea of before takes over with a hint, so the text can still be edited and nothing is
// lost. The failed import is simulated with a module that throws.

import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import RichTextEditorHarness from '$lib/test/RichTextEditorHarness.svelte';

vi.mock('$lib/editor/create-editor', () => {
	throw new Error('Chunk nicht erreichbar');
});

describe('RichTextEditor without its chunk', () => {
	it('falls back to the textarea with a hint and keeps the text', async () => {
		const { component } = render(RichTextEditorHarness, { props: { initial: '**fett**' } });
		const textarea = await screen.findByLabelText<HTMLTextAreaElement>('Beschreibung (Markdown)');
		expect(textarea.value).toBe('**fett**');
		const hint = screen.getByText(/Der Editor konnte nicht geladen werden/);
		expect(textarea.getAttribute('aria-describedby')).toContain(hint.id);
		const toggle = screen.getByRole('button', { name: 'Markdown' });
		expect(toggle.getAttribute('aria-pressed')).toBe('true');
		expect(toggle.getAttribute('aria-disabled')).toBe('true');

		await fireEvent.input(textarea, { target: { value: 'weiter' } });
		expect(component.current()).toBe('weiter');
	});
});
