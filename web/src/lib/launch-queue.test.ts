// Launches of the installed web app (ADR-0035 section 8; plan start-fenster, SF-5): the start page
// and the page already shown only focus the window, another page of the app is opened in it, and
// other origins are ignored. Without the Launch Handler API nothing happens.

import { describe, expect, it, vi } from 'vitest';
import { consumeLaunches, launchTarget } from './launch-queue';

const ORIGIN = 'http://127.0.0.1:8090';
const current = new URL(`${ORIGIN}/eingang?zustand=alle`);

describe('launchTarget', () => {
	it('opens another page of the app, with query and hash', () => {
		expect(launchTarget(`${ORIGIN}/eingang/neu?titel=Artikel&url=x`, current)).toBe(
			'/eingang/neu?titel=Artikel&url=x'
		);
		expect(launchTarget(`${ORIGIN}/tickets/abc#kommentare`, current)).toBe(
			'/tickets/abc#kommentare'
		);
	});

	it.each([
		['the start page', `${ORIGIN}/`],
		['the page already shown', `${ORIGIN}/eingang?zustand=alle`],
		['another origin', 'https://example.com/eingang/neu'],
		['localhost', 'http://localhost:8090/eingang/neu'],
		['no address', undefined],
		['a broken address', 'kein url']
	])('only focuses for %s', (_name, target) => {
		expect(launchTarget(target, current)).toBeNull();
	});
});

describe('consumeLaunches', () => {
	it('opens the target of a launch in this window', () => {
		let consumer: ((params: { targetURL?: unknown }) => void) | undefined;
		const win = { launchQueue: { setConsumer: vi.fn((next) => (consumer = next)) } };
		const navigate = vi.fn();
		consumeLaunches(win as unknown as Window, navigate, () => current);

		consumer?.({ targetURL: `${ORIGIN}/` });
		expect(navigate).not.toHaveBeenCalled();
		consumer?.({ targetURL: `${ORIGIN}/eingang/neu?titel=x` });
		expect(navigate).toHaveBeenCalledExactlyOnceWith('/eingang/neu?titel=x');
	});

	it('does nothing without the Launch Handler API', () => {
		const navigate = vi.fn();
		expect(() => consumeLaunches({} as Window, navigate, () => current)).not.toThrow();
		expect(navigate).not.toHaveBeenCalled();
	});
});
