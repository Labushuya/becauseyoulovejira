// "Ansehen" of a file of a watched folder (ADR-0051 §6): asks the server whether the current file
// of an entry can be shown and opens it, PDF, images and text in a new tab, everything else as a
// download in this tab. The file is a reference, not a copy: if it is gone, moved out of the
// folders or not readable, the answer says so and nothing opens. The (app) layout creates the
// store and puts it into the context; the panel of an entry and the sources of a ticket read it.

import type PocketBase from 'pocketbase';
import { createContext } from 'svelte';
import { SvelteSet } from 'svelte/reactivity';
import { toDataError } from '$lib/data/errors';
import { viewFolderFile, type FileViewOutcome } from '$lib/data/folders';
import { restartNeeded } from '$lib/guidance/texts';
import type { SessionGuard } from './ticket-list.svelte';

export interface FolderViewData {
	view(itemId: string): Promise<FileViewOutcome>;
}

export function folderViewData(pb: PocketBase): FolderViewData {
	return { view: (itemId) => viewFolderFile(pb, itemId) };
}

/**
 * Opens an address: in a new tab (`newTab`) or here (a download leaves the page where it is).
 * Returns false when the browser blocked the new tab.
 */
export type FileOpener = (url: string, newTab: boolean) => boolean;

/** The opener of the browser: the new tab gets no reference back to the app. */
export const browserOpener: FileOpener = (url, newTab) => {
	if (!newTab) {
		window.location.assign(url);
		return true;
	}
	const tab = window.open(url, '_blank');
	if (tab === null) return false;
	tab.opener = null;
	return true;
};

/** Shown while the server does not know the route yet (before the restart). */
export const FOLDER_VIEW_UNAVAILABLE_MESSAGE = restartNeeded('„Ansehen“ ist');

export const POPUP_BLOCKED_MESSAGE =
	'Der Browser hat den neuen Tab blockiert. Bitte Pop-ups für diese Seite erlauben oder die Datei herunterladen.';

/**
 * Why "Ansehen" opened nothing: neutral ("info") when the file is gone, outside the folders or the
 * tab was blocked, an error only when the request failed.
 */
export interface FileViewNote {
	tone: 'info' | 'error';
	text: string;
}

export class FolderViewer {
	readonly #data: FolderViewData;
	readonly #session: SessionGuard;
	readonly #open: FileOpener;
	readonly #busy = new SvelteSet<string>();

	constructor(data: FolderViewData, session: SessionGuard, open: FileOpener = browserOpener) {
		this.#data = data;
		this.#session = session;
		this.#open = open;
	}

	/** Whether "Ansehen" of the entry runs. */
	isBusy(itemId: string): boolean {
		return this.#busy.has(itemId);
	}

	/**
	 * Opens the current file of an entry (`download` downloads every type). Resolves to null once it
	 * opened, else to why not (the caller shows it at the entry).
	 */
	async open(itemId: string, { download = false } = {}): Promise<FileViewNote | null> {
		if (this.#busy.has(itemId) || !this.#session.ensureValid()) return null;
		this.#busy.add(itemId);
		try {
			const outcome = await this.#data.view(itemId);
			if (outcome.kind === 'refused') return { tone: 'info', text: outcome.message };
			const inline = outcome.view.inline && !download;
			const url = inline ? outcome.view.url : `${outcome.view.url}&download=1`;
			return this.#open(url, inline) ? null : { tone: 'info', text: POPUP_BLOCKED_MESSAGE };
		} catch (error) {
			const failure = toDataError(error);
			if (failure.kind === 'session') {
				this.#session.logout();
				return null;
			}
			return failure.kind === 'not_found'
				? { tone: 'info', text: FOLDER_VIEW_UNAVAILABLE_MESSAGE }
				: { tone: 'error', text: failure.message };
		} finally {
			this.#busy.delete(itemId);
		}
	}
}

const [getFolderViewer, setFolderViewer, hasFolderViewer] = createContext<FolderViewer>();

/** The viewer of the (app) layout, or null outside it (tests of single components). */
export function findFolderViewer(): FolderViewer | null {
	return hasFolderViewer() ? getFolderViewer() : null;
}

export { setFolderViewer };
