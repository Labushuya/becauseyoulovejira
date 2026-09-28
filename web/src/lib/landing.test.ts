// Landing page app\becauseyoulovejira.html (ADR-0035 section 1; plan start-fenster, SF-2): runs its
// inline script in jsdom with a fake window (location, fetch, close) and fake timers. The page
// checks /api/health at once and then every second (every 5 s when hidden), falls back to no-cors
// when CORS blocks the answer, asks the server for an open app tab and then opens the app at once,
// counts down 5 s (server came up later) or closes itself (another tab confirmed). Plus static
// rules: no external resources, no hex colors, the link "App öffnen" and the noscript text.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const HTML = readFileSync(
	join(import.meta.dirname, '..', '..', '..', 'app', 'becauseyoulovejira.html'),
	'utf8'
);
const APP_URL = 'http://127.0.0.1:8090/';
const HEALTH = `${APP_URL}api/health`;
const ATTENTION = `${APP_URL}api/byl/attention`;
const NONCE = 'Ab3dEf6hIj9kLm2nOp5qRs8t';

type Reply = { ok: boolean; status: number; json: () => Promise<unknown> };
type Handler = (url: string, init: RequestInit) => Promise<Reply>;

const reply = (status: number, body: unknown = null): Promise<Reply> =>
	Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
const networkError = (): Promise<Reply> => Promise.reject(new TypeError('Failed to fetch'));
/** Never answers; rejects with an AbortError once the page aborts it. */
const hang = (init: RequestInit): Promise<Reply> =>
	new Promise((_resolve, reject) => {
		init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
	});

interface Landing {
	next: (
		state: LandingState,
		event: { type: string; up?: boolean; acked?: boolean }
	) => LandingState;
	INITIAL: LandingState;
	COUNTDOWN_S: number;
}
interface LandingState {
	phase: string;
	remaining: number;
	firstUp: boolean;
}

function script(): string {
	const match = /<script>([\s\S]*?)<\/script>/.exec(HTML);
	if (!match?.[1]) throw new Error('landing page has no script');
	return match[1];
}

function start(handler: Handler, protocol = 'file:') {
	const body = /<body>([\s\S]*)<\/body>/.exec(HTML)?.[1] ?? '';
	document.body.innerHTML = body;
	const fetch = vi.fn((url: string, init: RequestInit = {}) => handler(url, init));
	const win = {
		location: { protocol, replace: vi.fn() },
		fetch,
		setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
		clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
		AbortController,
		close: vi.fn(),
		closed: false,
		BylLanding: undefined as Landing | undefined
	};
	new Function('window', 'document', script())(win, document);
	return win;
}

const byId = (id: string) => document.getElementById(id) as HTMLElement;
const status = () => byId('byl-status').textContent;
const visible = (id: string) => !byId(id).hidden;
/** Probes (the first try of each; a failed one is followed by a try in the no-cors mode). */
const healthCalls = (win: ReturnType<typeof start>) =>
	win.fetch.mock.calls.filter(([url, init]) => url === HEALTH && init?.mode !== 'no-cors').length;
const flush = () => vi.advanceTimersByTimeAsync(0);

/** Health answers up after `downFor` failed probes; the attention route answers as given. */
function server(
	options: {
		downFor?: number;
		attention?: () => Promise<Reply>;
		acks?: boolean[];
	} = {}
): Handler {
	let probes = 0;
	const acks = [...(options.acks ?? [])];
	return (url, init) => {
		if (url === HEALTH) {
			// A down server also fails the second try in the no-cors mode.
			if (init.mode === 'no-cors') return networkError();
			probes += 1;
			return probes > (options.downFor ?? 0) ? reply(200, { code: 200 }) : networkError();
		}
		if (url === `${ATTENTION}?reason=datei` && init.method === 'POST') {
			return options.attention ? options.attention() : reply(200, { nonce: NONCE, notified: 0 });
		}
		if (url === `${ATTENTION}/${NONCE}`) {
			return reply(200, { acked: acks.length > 0 ? acks.shift() : false });
		}
		return reply(404);
	};
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
	document.body.innerHTML = '';
});

describe('landing page: server already running (ADR-0035 section 1)', () => {
	it('opens the app in this tab at once when no app tab is open', async () => {
		const win = start(server());
		await flush();
		expect(win.location.replace).toHaveBeenCalledExactlyOnceWith(APP_URL);
		expect(status()).toBe('Die App wird geöffnet …');
		const post = win.fetch.mock.calls.find(([url]) => url === `${ATTENTION}?reason=datei`);
		expect(post?.[1]).toMatchObject({ method: 'POST', cache: 'no-store' });
		expect(post?.[1]).not.toHaveProperty('body');
		expect(visible('byl-now')).toBe(false);
	});

	it.each([
		['the route is missing', () => reply(404)],
		['too many messages', () => reply(429)],
		['CORS blocks the answer', networkError],
		['the answer has a bad nonce', () => reply(200, { nonce: '../x', notified: 2 })]
	])('opens the app when %s', async (_name, attention) => {
		const win = start(server({ attention }));
		await flush();
		expect(win.location.replace).toHaveBeenCalledExactlyOnceWith(APP_URL);
	});

	it('counts an opaque answer as running when CORS blocks /api/health', async () => {
		const win = start((url, init) => {
			if (url === HEALTH) return init.mode === 'no-cors' ? reply(0) : networkError();
			return networkError();
		});
		await flush();
		expect(
			win.fetch.mock.calls.filter(([url]) => url === HEALTH).map(([, init]) => init?.mode)
		).toEqual([undefined, 'no-cors']);
		expect(win.location.replace).toHaveBeenCalledExactlyOnceWith(APP_URL);
	});

	it('focuses the heading and always offers "App öffnen"', async () => {
		start(server());
		expect(document.activeElement).toBe(byId('byl-title'));
		const link = byId('byl-open') as HTMLAnchorElement;
		expect(link.getAttribute('href')).toBe(APP_URL);
		expect(link.textContent).toBe('App öffnen');
		expect(link.hidden).toBe(false);
	});
});

describe('landing page: server not running yet', () => {
	it('says how to start it and checks every second', async () => {
		const win = start(server({ downFor: Infinity }));
		await flush();
		expect(status()).toBe(
			'Die App läuft noch nicht. Starte sie mit start.bat im selben Ordner. Diese Seite erkennt den Start von selbst.'
		);
		expect(visible('byl-retry')).toBe(true);
		expect(visible('byl-checked')).toBe(true);
		expect(byId('byl-checked').textContent).toMatch(/^Zuletzt geprüft: /);
		await vi.advanceTimersByTimeAsync(3000);
		expect(healthCalls(win)).toBe(4);
		expect(win.location.replace).not.toHaveBeenCalled();
	});

	it('checks only every 5 s while the tab is hidden', async () => {
		Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
		const win = start(server({ downFor: Infinity }));
		await flush();
		await vi.advanceTimersByTimeAsync(10_000);
		expect(healthCalls(win)).toBe(3);
	});

	it('checks at once when the tab becomes visible again and on "Erneut prüfen"', async () => {
		Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
		const win = start(server({ downFor: Infinity }));
		await flush();
		Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
		document.dispatchEvent(new Event('visibilitychange'));
		await flush();
		expect(healthCalls(win)).toBe(2);
		byId('byl-retry').click();
		await flush();
		expect(healthCalls(win)).toBe(3);
	});

	it('treats a request that never answers as down after 1.5 s', async () => {
		const win = start((url, init) => (url === HEALTH ? hang(init) : networkError()));
		await vi.advanceTimersByTimeAsync(1500);
		expect(status()).toMatch(/^Die App läuft noch nicht/);
		expect(win.location.replace).not.toHaveBeenCalled();
	});

	it('counts down 5 s once the server came up and then opens the app', async () => {
		const win = start(server({ downFor: 3 }));
		await flush();
		await vi.advanceTimersByTimeAsync(2000);
		expect(healthCalls(win)).toBe(3);
		await vi.advanceTimersByTimeAsync(1000);
		expect(status()).toBe('Die App läuft und öffnet sich in 5 Sekunden.');
		expect(byId('byl-now').textContent).toBe('Jetzt öffnen (5 s)');
		expect(visible('byl-cancel')).toBe(true);
		// The server knows at once that this page takes over (start.bat opens no tab then).
		expect(win.fetch.mock.calls.some(([url]) => url === `${ATTENTION}?reason=datei`)).toBe(true);

		await vi.advanceTimersByTimeAsync(4000);
		expect(byId('byl-now').textContent).toBe('Jetzt öffnen (1 s)');
		// One announcement for the whole countdown.
		expect(status()).toBe('Die App läuft und öffnet sich in 5 Sekunden.');
		expect(win.location.replace).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1000);
		expect(win.location.replace).toHaveBeenCalledExactlyOnceWith(APP_URL);
	});

	it('"Abbrechen" stops the countdown for good, "App öffnen" stays', async () => {
		const win = start(server({ downFor: 1 }));
		await vi.advanceTimersByTimeAsync(1000);
		expect(visible('byl-now')).toBe(true);
		byId('byl-cancel').click();
		await vi.advanceTimersByTimeAsync(20_000);
		expect(win.location.replace).not.toHaveBeenCalled();
		expect(status()).toMatch(/^Automatisches Öffnen abgebrochen/);
		expect(visible('byl-now')).toBe(false);
		expect(visible('byl-open')).toBe(true);
		expect(healthCalls(win)).toBe(2);
	});

	it('"Jetzt öffnen" opens the app at once', async () => {
		const win = start(server({ downFor: 1 }));
		await vi.advanceTimersByTimeAsync(1000);
		byId('byl-now').click();
		expect(win.location.replace).toHaveBeenCalledExactlyOnceWith(APP_URL);
	});
});

describe('landing page: an app tab is open already', () => {
	it('closes itself 5 s after a tab confirmed', async () => {
		const win = start(
			server({ attention: () => reply(200, { nonce: NONCE, notified: 1 }), acks: [false, true] })
		);
		await flush();
		await vi.advanceTimersByTimeAsync(250);
		expect(status()).toBe(
			'becauseyoulovejira ist schon in einem anderen Tab offen. Dort erscheint ein Hinweis. Dieser Tab schließt sich in 5 Sekunden.'
		);
		expect(byId('byl-close').textContent).toBe('Jetzt schließen (5 s)');
		expect(visible('byl-here')).toBe(true);
		await vi.advanceTimersByTimeAsync(5000);
		expect(win.close).toHaveBeenCalledOnce();
		expect(win.location.replace).not.toHaveBeenCalled();
	});

	it('says what to do when the browser does not let it close', async () => {
		const win = start(
			server({ attention: () => reply(200, { nonce: NONCE, notified: 1 }), acks: [true] })
		);
		await flush();
		byId('byl-close').click();
		expect(win.close).toHaveBeenCalledOnce();
		await vi.advanceTimersByTimeAsync(300);
		expect(status()).toBe('Du kannst diesen Tab jetzt schließen.');
		byId('byl-here').click();
		expect(win.location.replace).toHaveBeenCalledExactlyOnceWith(APP_URL);
	});

	it('"Abbrechen" keeps the tab, "Trotzdem hier öffnen" opens the app', async () => {
		const win = start(
			server({ attention: () => reply(200, { nonce: NONCE, notified: 1 }), acks: [true] })
		);
		await flush();
		byId('byl-cancel').click();
		await vi.advanceTimersByTimeAsync(10_000);
		expect(win.close).not.toHaveBeenCalled();
		expect(status()).toBe(
			'becauseyoulovejira ist schon in einem anderen Tab offen. Dort erscheint ein Hinweis.'
		);
		byId('byl-here').click();
		expect(win.location.replace).toHaveBeenCalledExactlyOnceWith(APP_URL);
	});

	it('opens the app when no tab confirms within 2 s', async () => {
		const win = start(server({ attention: () => reply(200, { nonce: NONCE, notified: 2 }) }));
		await flush();
		await vi.advanceTimersByTimeAsync(1750);
		expect(win.location.replace).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(500);
		expect(win.location.replace).toHaveBeenCalledExactlyOnceWith(APP_URL);
		expect(win.close).not.toHaveBeenCalled();
	});
});

describe('landing page: state machine and other ways in', () => {
	it('goes to the root of the server when loaded over http', () => {
		const win = start(server(), 'http:');
		expect(win.location.replace).toHaveBeenCalledExactlyOnceWith('/');
		expect(win.fetch).not.toHaveBeenCalled();
	});

	it('ignores events that do not fit the phase', () => {
		const win = start(server(), 'http:');
		const landing = win.BylLanding as Landing;
		const { next, INITIAL } = landing;
		expect(landing.COUNTDOWN_S).toBe(5);
		expect(next(INITIAL, { type: 'tick' })).toBe(INITIAL);
		expect(next(INITIAL, { type: 'answer', acked: true })).toBe(INITIAL);
		const up = next(INITIAL, { type: 'probe', up: true });
		const opening = next(up, { type: 'answer', acked: false });
		expect(opening.phase).toBe('opening');
		expect(next(opening, { type: 'probe', up: false })).toBe(opening);
		const upLater = next(next(INITIAL, { type: 'probe', up: false }), { type: 'probe', up: true });
		const later = next(upLater, { type: 'answer', acked: false });
		expect(later).toEqual({ phase: 'countdown', remaining: 5, firstUp: false });
		expect(next(later, { type: 'close' })).toBe(later);
	});
});

describe('landing page: static rules', () => {
	it('loads nothing from outside and names only the app address', () => {
		expect(HTML).not.toMatch(/<script\b[^>]*\bsrc=/i);
		expect(HTML).not.toMatch(/<link\b/i);
		expect(HTML).not.toMatch(/@import|url\(/i);
		const addresses = [...HTML.matchAll(/https?:\/\/[^\s'"<)]+/g)].map((match) => match[0]);
		expect(addresses.length).toBeGreaterThan(0);
		expect(addresses.filter((address) => !address.startsWith(APP_URL))).toEqual([]);
	});

	it('uses system colors only, no hex values', () => {
		const style = /<style>([\s\S]*?)<\/style>/.exec(HTML)?.[1] ?? '';
		expect(style).toMatch(/Canvas/);
		expect(HTML).not.toMatch(/#[0-9a-f]{3,8}\b/i);
		expect(style).not.toMatch(/rgb|hsl|oklch/i);
	});

	it('works without script and is German, UTF-8 and a status region', () => {
		expect(HTML).toMatch(/<html lang="de">/);
		expect(HTML).toMatch(/<meta charset="utf-8" \/>/);
		expect(HTML).toMatch(
			/<noscript>\s*<p>Ohne JavaScript: start\.bat ausführen und http:\/\/127\.0\.0\.1:8090\/ öffnen\.<\/p>/
		);
		expect(HTML).toMatch(
			/<a id="byl-open" class="open" href="http:\/\/127\.0\.0\.1:8090\/">App öffnen<\/a>/
		);
		expect(HTML).toMatch(/<p id="byl-status" role="status" aria-live="polite">/);
	});
});
