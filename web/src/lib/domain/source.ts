// Source families (ADR-0019 section 1): the way a ticket or inbox entry came in, grouped by what
// it is for the user, not by the technical channel (a mail is a mail, file or mailbox). Pure.
// The inbox uses the families as chips from E4 package 3; filter, grouping and symbol of the
// ticket table follow in package 9.

import type { InboxChannel } from './inbox';

export const SOURCE_FAMILIES = ['manual', 'link', 'mail', 'calendar', 'chat', 'notion'] as const;
export type SourceFamily = (typeof SOURCE_FAMILIES)[number];

/** Families offered as chips; Notion only once its channel exists (ADR-0019 section 1). */
export const SOURCE_FAMILY_CHIPS: readonly SourceFamily[] = Object.freeze([
	'manual',
	'link',
	'mail',
	'calendar',
	'chat'
]);

export const SOURCE_FAMILY_LABELS: Readonly<Record<SourceFamily, string>> = Object.freeze({
	manual: 'Manuell',
	link: 'Web-Link',
	mail: 'Mail',
	calendar: 'Kalender',
	chat: 'Chat',
	notion: 'Notion'
});

/** Values of the URL parameter `quelle` (ADR-0019 section 1). */
export const SOURCE_FAMILY_VALUES: Readonly<Record<SourceFamily, string>> = Object.freeze({
	manual: 'manuell',
	link: 'link',
	mail: 'mail',
	calendar: 'kalender',
	chat: 'chat',
	notion: 'notion'
});

const FAMILY_OF: Readonly<Record<InboxChannel, SourceFamily>> = Object.freeze({
	manual: 'manual',
	quick: 'manual',
	clipboard: 'manual',
	link: 'link',
	eml: 'mail',
	mail: 'mail',
	ics: 'calendar',
	calendar: 'calendar',
	whatsapp: 'chat',
	telegram: 'chat',
	notion: 'notion'
});

/** Family of a source; no source (tickets before E4) counts as "manual" (ADR-0019). */
export function sourceFamily(source: InboxChannel | null): SourceFamily {
	return source === null ? 'manual' : FAMILY_OF[source];
}

/** Channels of a family, in the order of the value list. */
export function channelsOf(family: SourceFamily): InboxChannel[] {
	return (Object.keys(FAMILY_OF) as InboxChannel[]).filter(
		(channel) => FAMILY_OF[channel] === family
	);
}
