// Unsaved input of the open page (MO-1b, ADR-0073 addendum): the places that hold typed input
// register a check here, so leaving the page in the phone frame (reload, pulling down to refresh,
// closing the tab) can ask the browser's question first. Every modal registers its `dirty`
// (the quick entry, the dialogs with forms), the ticket its fields, description, comments and
// template, the forms of the panels ("Neues Ticket", "Erfassen", project, rule) theirs. Plain
// functions, read only at the moment of leaving; no state, so nothing renders anew.

const checks = new Set<() => boolean>();

/** Registers a check for unsaved input; returns the function that removes it again. */
export function registerUnsavedInput(check: () => boolean): () => void {
	checks.add(check);
	return () => {
		checks.delete(check);
	};
}

/** Whether any registered place holds input that is not saved now. */
export function hasUnsavedInput(): boolean {
	for (const check of checks) {
		if (check()) return true;
	}
	return false;
}
