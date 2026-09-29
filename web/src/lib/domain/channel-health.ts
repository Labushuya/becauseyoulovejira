// State of a connection at a glance (ADR-0026 section 3, plan EH-3 and §3.5): one pure function
// decides the lozenge, the one hint of the card and the main action. The order of the checks is
// fixed: a running fetch, then paused, then missing access data, then the last error, else set up.
// An unknown state of the variables (null, request failed) skips the check for missing data.

import {
	NO_KEYWORDS_WARNING,
	fetchesAutomatically,
	secretStatusText,
	type Connection,
	type SecretStatus
} from './connections';

export type ChannelHealthState = 'running' | 'paused' | 'unset' | 'error' | 'ok';

export interface ChannelHealth {
	state: ChannelHealthState;
	/** Text of the lozenge. */
	label: string;
	/** Tone of the lozenge; "danger" only for a real error (ADR-0009). */
	tone: 'neutral' | 'brand' | 'danger' | 'muted';
	/** Icon of the lozenge (GuidanceIcon). */
	icon: 'refresh' | 'pause' | 'pending' | 'error' | 'check';
	/** At most one compact hint of the card. */
	hint: { tone: 'info' | 'warning' | 'error'; text: string } | null;
	/**
	 * Main action of the card. Since package A (item 4) every set-up connection has "Jetzt abrufen",
	 * a mailbox too (the hook asks the mail helper).
	 */
	action: 'run' | 'resume' | 'setup' | 'none';
	/** A mailbox that is set up also offers "Aus dem Postfach wählen" next to the main action. */
	pick: boolean;
}

type ConnectionFacts = Pick<
	Connection,
	'type' | 'enabled' | 'secretEnv' | 'allowlistEnv' | 'lastError' | 'lastHint' | 'keywords'
>;

export function channelHealth(
	connection: ConnectionFacts,
	secretStatus: SecretStatus | null,
	running: boolean
): ChannelHealth {
	const health = baseHealth(connection, secretStatus, running);
	return {
		...health,
		pick:
			connection.type === 'mail' &&
			(health.state === 'ok' || health.state === 'error' || health.state === 'running')
	};
}

function baseHealth(
	connection: ConnectionFacts,
	secretStatus: SecretStatus | null,
	running: boolean
): Omit<ChannelHealth, 'pick'> {
	const regular: ChannelHealth['action'] = 'run';
	if (running) {
		return {
			state: 'running',
			label: 'Wird abgerufen',
			tone: 'brand',
			icon: 'refresh',
			hint: null,
			action: 'none'
		};
	}
	if (!connection.enabled) {
		return {
			state: 'paused',
			label: 'Pausiert',
			tone: 'muted',
			icon: 'pause',
			hint: {
				tone: 'info',
				text:
					connection.type === 'mail'
						? 'Pausiert: Der Hilfsprozess ruft pausierte Postfächer nicht ab.'
						: 'Pausiert: Die App ruft nichts ab.'
			},
			action: 'resume'
		};
	}
	const secret = secretStatusText(connection, secretStatus);
	if (secret !== null && !secret.ok) {
		return {
			state: 'unset',
			label: 'Nicht eingerichtet',
			tone: 'neutral',
			icon: 'pending',
			hint: { tone: 'warning', text: secret.text },
			action: 'setup'
		};
	}
	if (connection.lastError !== '') {
		const hint = connection.lastHint !== '' ? ` ${connection.lastHint}` : '';
		return {
			state: 'error',
			label: 'Fehler',
			tone: 'danger',
			icon: 'error',
			hint: { tone: 'error', text: `Letzter Fehler: ${connection.lastError}${hint}` },
			action: regular
		};
	}
	// The hint of the last run wins over the missing keywords: it may carry the chat ID Telegram
	// needs for the allowlist; the meta line "Stichwörter: keine" still shows the missing keywords.
	// Notion has no keywords (ADR-0041): the user chooses what to import.
	let hint: ChannelHealth['hint'] = null;
	if (connection.lastHint !== '') hint = { tone: 'info', text: connection.lastHint };
	else if (connection.keywords.length === 0 && fetchesAutomatically(connection.type)) {
		hint = { tone: 'warning', text: NO_KEYWORDS_WARNING };
	}
	return {
		state: 'ok',
		label: 'Eingerichtet',
		tone: 'brand',
		icon: 'check',
		hint,
		action: regular
	};
}

/** Keywords for the card: the number and the first three words, the rest as "+n". */
export function keywordSummary(keywords: readonly string[]): string {
	if (keywords.length === 0) return 'keine';
	const shown = keywords.slice(0, 3).join(', ');
	const rest = keywords.length - 3;
	return rest > 0 ? `${keywords.length} (${shown}, +${rest})` : `${keywords.length} (${shown})`;
}
