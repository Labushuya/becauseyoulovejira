// Title bar of the installed web app (ADR-0035 section 8; plan start-fenster, SF-5): app.html has
// two <meta name="theme-color"> with the background token of the light and the dark mode, chosen
// by the system setting. A mode chosen in the app ("Hell", "Dunkel") can differ from the system,
// so this module sets both to the background the page actually shows, read from --color-bg: no
// color value outside tokens.css. It follows a new choice (data-theme) and a new system setting.

const SELECTOR = 'meta[name="theme-color"]';

/** Sets every theme-color meta to the current --color-bg; does nothing without a value. */
export function syncThemeColor(win: Window, doc: Document): void {
	const color = win.getComputedStyle(doc.documentElement).getPropertyValue('--color-bg').trim();
	if (color === '') return;
	for (const meta of doc.querySelectorAll<HTMLMetaElement>(SELECTOR)) {
		if (meta.content !== color) meta.content = color;
	}
}

/** Keeps the theme-color in step with the shown mode; returns the stop. */
export function watchThemeColor(win: Window, doc: Document): () => void {
	const update = () => syncThemeColor(win, doc);
	update();
	const observer = new MutationObserver(update);
	observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
	const media =
		typeof win.matchMedia === 'function' ? win.matchMedia('(prefers-color-scheme: dark)') : null;
	media?.addEventListener('change', update);
	return () => {
		observer.disconnect();
		media?.removeEventListener('change', update);
	};
}
