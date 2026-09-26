// Keyboard of a tab list (WAI-ARIA APG "Tabs", plan EH-5 §3.11): arrow keys move between the tabs
// in a circle, Home and End go to the first and the last. With manual activation the move only
// shifts the focus; Enter or Space selects. Pure module.

/** Index of the tab the key moves the focus to, or null for any other key. */
export function tabTarget(key: string, index: number, count: number): number | null {
	if (count <= 0) return null;
	const last = count - 1;
	switch (key) {
		case 'ArrowRight':
			return index >= last ? 0 : index + 1;
		case 'ArrowLeft':
			return index <= 0 ? last : index - 1;
		case 'Home':
			return 0;
		case 'End':
			return last;
		default:
			return null;
	}
}
