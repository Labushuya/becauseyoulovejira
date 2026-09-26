// Bookmarklet card (E4 plan, package 7; ADR-0026 section 6, plan EH-4): the draggable knob with the
// code for the address of the app and its description, no effect on a click, the code to copy for
// keyboard users in a folded code block instead of a textarea, and the illustration that plays
// twice when first visible, once on hover or focus, and not at all with reduced motion.
// Until EH-4 these cases lived in channels-view.test.ts.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bookmarkletCode } from '$lib/domain/bookmarklet';
import BookmarkletCard from './BookmarkletCard.svelte';

const CAPTURE = 'http://127.0.0.1:8090/eingang/neu';

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

/** Fake IntersectionObserver; `show()` reports the card as visible. */
function stubIntersection() {
	const observers: { callback: IntersectionObserverCallback; disconnected: boolean }[] = [];
	vi.stubGlobal(
		'IntersectionObserver',
		class {
			entry: { callback: IntersectionObserverCallback; disconnected: boolean };
			constructor(callback: IntersectionObserverCallback) {
				this.entry = { callback, disconnected: false };
				observers.push(this.entry);
			}
			observe() {}
			disconnect() {
				this.entry.disconnected = true;
			}
		}
	);
	return {
		observers,
		show() {
			for (const observer of observers) {
				if (!observer.disconnected) {
					observer.callback(
						[{ isIntersecting: true } as IntersectionObserverEntry],
						{} as IntersectionObserver
					);
				}
			}
		}
	};
}

function stubReducedMotion(matches: boolean) {
	vi.stubGlobal('matchMedia', (query: string) => ({
		matches: query.includes('reduce') ? matches : false,
		media: query,
		addEventListener: () => undefined,
		removeEventListener: () => undefined
	}));
}

const ghost = () => document.querySelector<SVGGElement>('.ghost');

describe('bookmarklet card', () => {
	it('offers a designed card with the draggable knob for the address of the app', () => {
		render(BookmarkletCard, { props: { captureUrl: CAPTURE } });
		expect(
			screen.getByRole('heading', { level: 4, name: 'Web-Links per Bookmarklet' })
		).toBeTruthy();
		const link = screen.getByRole('link', { name: 'In den Eingang' });
		expect(link.getAttribute('href')).toBe(bookmarkletCode(CAPTURE));
		expect(link.getAttribute('draggable')).toBe('true');
		expect(link.classList.contains('bookmarklet')).toBe(true);
		expect(
			document.getElementById(link.getAttribute('aria-describedby') ?? '')?.textContent
		).toMatch(
			/Ziehe diesen Knopf auf deine Lesezeichenleiste \(Strg\+Umschalt\+B blendet sie ein\)/
		);
		expect(screen.getByText(/Gespeichert wird erst, wenn du dort auf/)).toBeTruthy();
		// No raw code in a textarea any more.
		expect(document.querySelector('textarea')).toBeNull();
		expect(screen.getByText(/Nur http- und https-Seiten/)).toBeTruthy();
	});

	it('does nothing on a click in the app and says why', async () => {
		render(BookmarkletCard, { props: { captureUrl: CAPTURE } });
		const link = screen.getByRole('link', { name: 'In den Eingang' });
		const click = new MouseEvent('click', { bubbles: true, cancelable: true });
		link.dispatchEvent(click);
		expect(click.defaultPrevented).toBe(true);
		const hint = await screen.findByText(
			/Ziehen statt klicken: Der Knopf gehört auf die Lesezeichenleiste/
		);
		expect(hint.closest('[role="status"]')?.getAttribute('data-tone')).toBe('info');
	});

	it('shows the code in a folded code block and copies it for the keyboard', async () => {
		const writeText = vi.fn(async () => undefined);
		vi.stubGlobal('navigator', { clipboard: { writeText } });
		render(BookmarkletCard, { props: { captureUrl: CAPTURE } });
		const summary = screen.getByText('Ohne Maus einrichten');
		expect(summary.tagName).toBe('SUMMARY');
		expect(summary.closest('details')?.open).toBe(false);
		const region = screen.getByRole('region', { name: 'Code des Bookmarklets' });
		expect(region.textContent).toBe(bookmarkletCode(CAPTURE));
		await fireEvent.click(screen.getByRole('button', { name: 'Code des Bookmarklets kopieren' }));
		expect(writeText).toHaveBeenCalledWith(bookmarkletCode(CAPTURE));
		await vi.waitFor(() => expect(screen.getByText('Code des Bookmarklets kopiert.')).toBeTruthy());
	});

	it('explains how to copy by hand when the browser refuses', async () => {
		vi.stubGlobal('navigator', {
			clipboard: {
				writeText: async () => {
					throw new Error('denied');
				}
			}
		});
		render(BookmarkletCard, { props: { captureUrl: CAPTURE } });
		await fireEvent.click(screen.getByRole('button', { name: 'Code des Bookmarklets kopieren' }));
		await vi.waitFor(() => expect(screen.getByText(/Strg\+C/)).toBeTruthy());
	});

	it('plays the illustration twice when the card first becomes visible, then once on hover or focus', async () => {
		stubReducedMotion(false);
		const intersection = stubIntersection();
		render(BookmarkletCard, { props: { captureUrl: CAPTURE } });
		await tick();
		expect(ghost()?.classList.contains('playing')).toBe(false);
		expect(document.querySelector('.illustration')?.getAttribute('aria-hidden')).toBe('true');

		intersection.show();
		await tick();
		expect(ghost()?.classList.contains('playing')).toBe(true);
		expect(ghost()?.style.animationIterationCount).toBe('2');
		expect(intersection.observers.every((observer) => observer.disconnected)).toBe(true);

		await fireEvent.animationEnd(ghost() as SVGGElement);
		expect(ghost()?.classList.contains('playing')).toBe(false);

		await fireEvent.focus(screen.getByRole('link', { name: 'In den Eingang' }));
		expect(ghost()?.classList.contains('playing')).toBe(true);
		expect(ghost()?.style.animationIterationCount).toBe('1');
	});

	it('shows a still arrow instead of the motion with reduced motion', async () => {
		stubReducedMotion(true);
		const intersection = stubIntersection();
		render(BookmarkletCard, { props: { captureUrl: CAPTURE } });
		await tick();
		intersection.show();
		await fireEvent.mouseEnter(screen.getByRole('link', { name: 'In den Eingang' }));
		await tick();
		expect(ghost()).toBeNull();
		expect(document.querySelector('.arrow:not(.still)')).not.toBeNull();
	});

	it('shows where to drop while the knob is dragged', async () => {
		render(BookmarkletCard, { props: { captureUrl: CAPTURE } });
		const link = screen.getByRole('link', { name: 'In den Eingang' });
		await fireEvent.dragStart(link);
		expect(screen.getByText('Loslassen auf der Lesezeichenleiste')).toBeTruthy();
		await fireEvent.dragEnd(link);
		expect(screen.queryByText('Loslassen auf der Lesezeichenleiste')).toBeNull();
	});

	it('animates with the motion tokens and turns the motion off for reduced motion in CSS too', () => {
		const source = readFileSync(join(import.meta.dirname, 'BookmarkletCard.svelte'), 'utf8');
		expect(source).toMatch(/animation: glide 1\.8s var\(--motion-ease\)/);
		expect(source).toMatch(
			/@media \(prefers-reduced-motion: reduce\) \{\s*\.ghost \{\s*display: none;/
		);
	});
});
