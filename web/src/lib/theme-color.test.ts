// Title bar of the installed web app (ADR-0035 section 8; plan start-fenster, SF-5): both
// theme-color metas follow --color-bg of the shown mode, also when the mode chosen in the app
// differs from the system, and after a new choice.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { syncThemeColor, watchThemeColor } from './theme-color';

function metas(): HTMLMetaElement[] {
	return [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
}

beforeEach(() => {
	document.head.innerHTML =
		'<meta name="theme-color" content="#f5f8f8" media="(prefers-color-scheme: light)">' +
		'<meta name="theme-color" content="#0e1517" media="(prefers-color-scheme: dark)">';
	document.documentElement.style.setProperty('--color-bg', '#f5f8f8');
});

afterEach(() => {
	document.head.innerHTML = '';
	document.documentElement.style.removeProperty('--color-bg');
	document.documentElement.removeAttribute('data-theme');
});

describe('theme-color', () => {
	it('sets both metas to the background that is shown', () => {
		document.documentElement.style.setProperty('--color-bg', '#0e1517');
		syncThemeColor(window, document);
		expect(metas().map((meta) => meta.content)).toEqual(['#0e1517', '#0e1517']);
	});

	it('keeps the metas without a value', () => {
		document.documentElement.style.removeProperty('--color-bg');
		syncThemeColor(window, document);
		expect(metas().map((meta) => meta.content)).toEqual(['#f5f8f8', '#0e1517']);
	});

	it('follows a new choice of the mode and stops on request', async () => {
		const stop = watchThemeColor(window, document);
		expect(metas().map((meta) => meta.content)).toEqual(['#f5f8f8', '#f5f8f8']);

		document.documentElement.style.setProperty('--color-bg', '#0e1517');
		document.documentElement.setAttribute('data-theme', 'dark');
		await Promise.resolve();
		expect(metas().map((meta) => meta.content)).toEqual(['#0e1517', '#0e1517']);

		stop();
		document.documentElement.style.setProperty('--color-bg', '#f5f8f8');
		document.documentElement.setAttribute('data-theme', 'light');
		await Promise.resolve();
		expect(metas().map((meta) => meta.content)).toEqual(['#0e1517', '#0e1517']);
	});
});
