// Commands of the guides (ADR-0026 section 6, plan EH-4 and §3.9): a template with placeholders in
// double braces, e.g. `setx BYL_TELEGRAM_TOKEN "{{token}}"`, is split into segments. The display
// masks secret values, the copy contains the real value; the checks say what setx cannot take.
// Pure module: no DOM, no storage, no requests.

export interface PlaceholderInfo {
	/** Visible name of the placeholder, e.g. "Bot-Token". */
	label: string;
	/** Secret values are masked in the display (calendar address, token, passwords). */
	secret: boolean;
}

export type CommandSegment =
	| { kind: 'text'; text: string }
	| { kind: 'placeholder'; name: string; label: string; secret: boolean };

const PLACEHOLDER = /\{\{([a-z][a-z0-9-]*)\}\}/g;

/** Mask of a secret value in the display. */
export const SECRET_MASK = '••••••••';

/**
 * Segments of a template. A placeholder without an entry in `placeholders` is shown with its name
 * and counts as secret, so nothing is revealed by mistake.
 */
export function parseTemplate(
	template: string,
	placeholders: Readonly<Record<string, PlaceholderInfo>> = {}
): CommandSegment[] {
	const segments: CommandSegment[] = [];
	let last = 0;
	for (const match of template.matchAll(PLACEHOLDER)) {
		const index = match.index ?? 0;
		if (index > last) segments.push({ kind: 'text', text: template.slice(last, index) });
		const name = match[1] ?? '';
		const info = placeholders[name];
		segments.push({
			kind: 'placeholder',
			name,
			label: info?.label ?? name,
			secret: info?.secret ?? true
		});
		last = index + match[0].length;
	}
	if (last < template.length) segments.push({ kind: 'text', text: template.slice(last) });
	return segments;
}

/**
 * Display and copy text of a command. A placeholder without a value stays as "‹Label›" in both;
 * a secret value is masked in the display only.
 */
export function renderCommand(
	segments: readonly CommandSegment[],
	values: Readonly<Record<string, string>> = {}
): { display: string; copy: string } {
	let display = '';
	let copy = '';
	for (const segment of segments) {
		if (segment.kind === 'text') {
			display += segment.text;
			copy += segment.text;
			continue;
		}
		const value = values[segment.name] ?? '';
		if (value === '') {
			display += `‹${segment.label}›`;
			copy += `‹${segment.label}›`;
		} else {
			display += segment.secret ? SECRET_MASK : value;
			copy += value;
		}
	}
	return { display, copy };
}

export interface ValueCheck {
	level: 'error' | 'warning';
	message: string;
}

/** Longest value setx stores; longer ones it cuts off without a word. */
export const SETX_MAX_LENGTH = 1024;

/** What `setx NAME "value"` cannot take, or null. */
export function setxValueError(value: string): ValueCheck | null {
	if (value.includes('"')) {
		return {
			level: 'error',
			message: 'Anführungszeichen gehen mit setx nicht; nutze die Systemsteuerung.'
		};
	}
	if (/[\r\n]/.test(value)) {
		return { level: 'error', message: 'Der Wert darf keinen Zeilenumbruch enthalten.' };
	}
	if (value.length > SETX_MAX_LENGTH) {
		return {
			level: 'error',
			message: `Höchstens ${SETX_MAX_LENGTH} Zeichen; setx würde den Rest still abschneiden.`
		};
	}
	if (/%[^%\s]+%/.test(value)) {
		return {
			level: 'warning',
			message: 'cmd könnte den Teil zwischen den Prozentzeichen als Variable lesen.'
		};
	}
	return null;
}

/** The value as it goes into the command: Gmail app passwords without the spaces between groups. */
export function normalizeValue(kind: 'gmail' | 'other', value: string): string {
	return kind === 'gmail' ? value.replace(/\s+/g, '') : value.trim();
}
