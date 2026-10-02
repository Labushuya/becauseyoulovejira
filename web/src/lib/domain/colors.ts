// Colors of projects and tickets (ADR-0052, plan docs/plan/farben.md). Pure. A project has one of
// a fixed palette or none; a sub project without one takes the color of its parent (one level,
// ADR-0034); a ticket shows its own color or else the one of its project. The color is an extra:
// it shows as a stripe or a dot, never as a filled surface, and always together with its name
// (title, text for screen readers). The values live as tokens `--project-color-<key>` in tokens.css,
// the same keys are the values of the select fields projects.color, tickets.color and
// recurrence_rules.color (migration 1790203400; tests/integration/colors.test.mjs keeps them equal).
// The calendar (its own package) takes the color of a ticket from `ticketColorOf`.

/**
 * The palette in the order of the choice: around the hue circle from violet over blue, green and
 * yellow to brown, then the neutral gray. No red, orange or pink: red stays for real errors
 * (ADR-0009), and the error colors of the themes Rubin (brick) and Kupfer (crimson) lie there.
 */
export const PROJECT_COLORS = [
	'violett',
	'indigo',
	'blau',
	'himmel',
	'tuerkis',
	'gruen',
	'oliv',
	'senf',
	'braun',
	'grau'
] as const;

export type ProjectColor = (typeof PROJECT_COLORS)[number];

/** Names of the colors as the interface shows them. */
export const COLOR_LABELS: Readonly<Record<ProjectColor, string>> = Object.freeze({
	violett: 'Violett',
	indigo: 'Indigo',
	blau: 'Blau',
	himmel: 'Himmelblau',
	tuerkis: 'Türkis',
	gruen: 'Grün',
	oliv: 'Oliv',
	senf: 'Senf',
	braun: 'Braun',
	grau: 'Grau'
});

export function isProjectColor(value: unknown): value is ProjectColor {
	return (PROJECT_COLORS as readonly unknown[]).includes(value);
}

/** A stored value as a color: '' (none) and anything unknown are null. */
export function colorOf(value: unknown): ProjectColor | null {
	return isProjectColor(value) ? value : null;
}

/** The CSS value of a color: its token, which tokens.css defines for every mode. */
export function colorVar(color: ProjectColor): string {
	return `var(--project-color-${color})`;
}

/** Where a shown color comes from. */
export type ColorOrigin = 'own' | 'project' | 'parent';

/** The color a project or ticket shows, where it comes from and the name of that project. */
export interface ShownColor {
	color: ProjectColor;
	origin: ColorOrigin;
	/** Name of the project the color comes from; null for an own color. */
	from: string | null;
}

/** What the effective color needs of a project: its color and its parent (catalog, ADR-0034). */
export interface ColoredProject {
	name: string;
	color?: ProjectColor | null;
	parent?: { name: string; color?: ProjectColor | null } | null;
}

/**
 * The color of a project: its own, else the one of its parent (sub projects inherit as long as
 * they have none of their own), else none. `origin` is 'own' for the project itself.
 */
export function projectColorOf(project: ColoredProject | null): ShownColor | null {
	if (project === null) return null;
	if (project.color) return { color: project.color, origin: 'own', from: null };
	const parent = project.parent ?? null;
	if (parent?.color) return { color: parent.color, origin: 'parent', from: parent.name };
	return null;
}

/**
 * The effective color of a ticket: its own color, else the color of its project, else the one of
 * the parent of that project, else none. The calendar and every list use this one function.
 * `project` is the project as the catalog resolves it (with its parent).
 */
export function ticketColorOf(
	ticket: { color?: ProjectColor | null },
	project: ColoredProject | null
): ShownColor | null {
	if (ticket.color) return { color: ticket.color, origin: 'own', from: null };
	const shown = projectColorOf(project);
	if (shown === null || project === null) return null;
	return shown.origin === 'own'
		? { color: shown.color, origin: 'project', from: project.name }
		: { color: shown.color, origin: 'parent', from: shown.from };
}

/**
 * Name of a shown color for the tooltip and screen readers: "Farbe Blau", "Farbe Blau, vom Projekt
 * „Haus“" or "Farbe Blau, vom Oberprojekt „Haus“".
 */
export function colorText(shown: ShownColor): string {
	const name = `Farbe ${COLOR_LABELS[shown.color]}`;
	if (shown.from === null) return name;
	const owner = shown.origin === 'parent' ? 'Oberprojekt' : 'Projekt';
	return `${name}, vom ${owner} „${shown.from}“`;
}

/**
 * Label of the choice "no own color": for a ticket "Wie Projekt" with the color it then shows
 * ("Wie Projekt (Blau)", "Wie Projekt (keine)"), for a sub project "Wie Oberprojekt (Blau)", for a
 * top-level project "Keine".
 */
export function inheritLabel(
	kind: 'ticket' | 'sub-project' | 'project',
	inherited: ProjectColor | null
): string {
	if (kind === 'project') return 'Keine';
	const name = inherited === null ? 'keine' : COLOR_LABELS[inherited];
	return `${kind === 'ticket' ? 'Wie Projekt' : 'Wie Oberprojekt'} (${name})`;
}
