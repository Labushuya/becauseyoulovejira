// IDs in the rendered DOM for component tests: every ID once, and every ID reference of
// `aria-describedby` and `aria-labelledby` pointing at an element that exists. A doubled ID breaks
// both (a screen reader reads the first element with it, whichever that is).

const REFERENCES = ['aria-describedby', 'aria-labelledby'] as const;

/** IDs that occur more than once below `root`, each named once. */
export function duplicateIds(root: ParentNode = document): string[] {
	const seen = new Set<string>();
	const doubled = new Set<string>();
	for (const element of root.querySelectorAll('[id]')) {
		if (seen.has(element.id)) doubled.add(element.id);
		seen.add(element.id);
	}
	return [...doubled];
}

/** References of `aria-describedby`/`aria-labelledby` below `root` without a target in the document. */
export function danglingReferences(root: ParentNode = document): string[] {
	const dangling: string[] = [];
	for (const attribute of REFERENCES) {
		for (const element of root.querySelectorAll(`[${attribute}]`)) {
			for (const id of (element.getAttribute(attribute) ?? '').split(/\s+/).filter(Boolean)) {
				if (!document.getElementById(id)) dangling.push(`${attribute}="${id}"`);
			}
		}
	}
	return dangling;
}
