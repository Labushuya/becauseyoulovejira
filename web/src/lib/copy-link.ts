// "Link kopieren" of a ticket (plan aktionsmenues, AM-1 and AM-2): writes the address of the ticket
// to the clipboard and says so in a flag (ADR-0025 section 8), because the menu that started it is
// gone by then. A browser that refuses the clipboard gets an error flag with the address in its
// text, so the user can still copy it by hand; the address is never logged.

import { writeClipboardText, type ClipboardTarget } from './clipboard';
import type { FlagSink } from './stores/flags.svelte';

export const LINK_COPIED_TITLE = 'Link kopiert';
export const LINK_NOT_COPIED_TITLE = 'Link konnte nicht kopiert werden.';

/** Copies `url`, the address of the ticket `key`; true when the clipboard took it. */
export async function copyTicketLink(
	key: string,
	url: string,
	flags: FlagSink,
	target?: ClipboardTarget
): Promise<boolean> {
	const copied = await writeClipboardText(url, target);
	if (copied) {
		flags.show({
			tone: 'success',
			title: LINK_COPIED_TITLE,
			description: `Der Link zu ${key} liegt in der Zwischenablage.`
		});
	} else {
		flags.show({
			tone: 'error',
			title: LINK_NOT_COPIED_TITLE,
			description: `Der Browser erlaubt den Zugriff auf die Zwischenablage nicht. Link zu ${key}: ${url}`
		});
	}
	return copied;
}
