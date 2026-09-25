import { getContext, setContext } from 'svelte';

// Side panel next to or over the view (ADR-0025 section 6; plan UI-Konsistenz, package UI-6b).
// From 64rem the panel is a column of its own right of the whole view, which becomes narrower;
// below it lies over the view from the right, with the blanket behind it, and the view (list and
// header) is inert. Both contexts are optional: without them (tests of a single component) nothing
// changes.

/** Media query of the embedded panel; below it the panel is an overlay. */
export const PANEL_EMBEDDED_QUERY = '(min-width: 64rem)';

/**
 * Close of the shown panel, registered by the Drawer, so a click on the blanket closes like the ×
 * (with the question about unsaved input, which the owner of the panel asks).
 */
export class PanelHost {
	#close: (() => void) | null = null;

	/** Registers the close of a drawer; the returned function removes it again. */
	register(close: () => void): () => void {
		this.#close = close;
		return () => {
			if (this.#close === close) this.#close = null;
		};
	}

	/** Closes the shown panel like its ×; false without a registered drawer. */
	close(): boolean {
		if (this.#close === null) return false;
		this.#close();
		return true;
	}
}

/** Shell of the app: whether a panel covers the view, so the header becomes inert as well. */
export class PanelShell {
	covering = $state(false);
}

const HOST = Symbol('panel-host');
const SHELL = Symbol('panel-shell');

export function setPanelHost(host: PanelHost): PanelHost {
	return setContext(HOST, host);
}

export function getPanelHost(): PanelHost | undefined {
	return getContext<PanelHost | undefined>(HOST);
}

export function setPanelShell(shell: PanelShell): PanelShell {
	return setContext(SHELL, shell);
}

export function getPanelShell(): PanelShell | undefined {
	return getContext<PanelShell | undefined>(SHELL);
}
