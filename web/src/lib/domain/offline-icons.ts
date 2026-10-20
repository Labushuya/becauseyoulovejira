/**
 * @license lucide-static v1.52.0 - ISC
 *
 * The symbols of the outbox (OF-2, ADR-0074 addendum OF-2): "cloud-upload" marks a change that is
 * not sent yet, "cloud-off" the missing connection in the top bar. Taken unchanged from Lucide
 * (https://lucide.dev, package lucide-static 1.52.0, ISC) like the symbols of the charms (ADR-0062).
 * License text and copyright: charm-icons.LICENSE.txt next to this file. No npm dependency: only
 * these drawings as data, in the grid of the charms (CHARM_SVG: viewBox 0 0 24 24, stroke 2 in
 * currentColor); the component OfflineIcon draws them.
 */

import type { IconShape } from './charm-icons';

/** The shapes of "cloud-upload" in Lucide 1.52.0. */
export const PENDING_ICON: readonly IconShape[] = Object.freeze([
	{ d: 'M12 13v8' },
	{ d: 'M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242' },
	{ d: 'm8 17 4-4 4 4' }
]);

/** The shapes of "cloud-off" in Lucide 1.52.0. */
export const OFFLINE_ICON: readonly IconShape[] = Object.freeze([
	{ d: 'M10.94 5.274A7 7 0 0 1 15.71 10h1.79a4.5 4.5 0 0 1 4.222 6.057' },
	{ d: 'M18.796 18.81A4.5 4.5 0 0 1 17.5 19H9A7 7 0 0 1 5.79 5.78' },
	{ d: 'm2 2 20 20' }
]);
