// State of a connection at a glance (ADR-0026 section 3, plan EH-3 and §3.5; since the plan
// kanal-karten KK-2 with the states of the unified card): one pure function decides the lozenge,
// the one hint of the card and the main action. The order of the checks is fixed: a running
// fetch, then paused, then missing access data, then the last error, then a mail helper that
// needs a restart, then an open step of the setup, else connected. An unknown state of the
// variables or of the mail helper (null, request failed) skips its check. Since KE-1 (ADR-0076)
// the open setup comes from `openSetupOf` (domain/open-setups.ts), the rule of the assistant: the
// card never says "Verbunden" while a mandatory step is open, and its hint names that step.

import { CARD_STATUS } from './channel-card';
import { setupKindOf, type StoredSecrets } from './channel-setup';
import {
	NO_KEYWORDS_WARNING,
	mailHelperText,
	secretOptional,
	secretStatusText,
	usesKeywords,
	type Connection,
	type MailHelperStatus,
	type SecretStatus
} from './connections';
import { NO_TOKEN_HINT } from './github';
import {
	OPEN_SETUP_TEXTS,
	isSecretReason,
	openSetupHint,
	openSetupOf,
	openStepPrefix
} from './open-setups';

export type ChannelHealthState =
	'running' | 'paused' | 'unset' | 'error' | 'restart' | 'open' | 'ok';

export interface ChannelHealth {
	state: ChannelHealthState;
	/** Text of the lozenge. */
	label: string;
	/** Tone of the lozenge; "danger" only for a real error (ADR-0009). */
	tone: 'neutral' | 'brand' | 'danger' | 'muted';
	/** Icon of the lozenge (GuidanceIcon). */
	icon: 'refresh' | 'pause' | 'pending' | 'error' | 'check' | 'warning';
	/** At most one compact hint of the card. */
	hint: { tone: 'info' | 'warning' | 'error'; text: string } | null;
	/**
	 * Main action of the card. Since package A (item 4) every set-up connection has "Jetzt abrufen",
	 * a mailbox too (the hook asks the mail helper).
	 */
	action: 'run' | 'resume' | 'setup' | 'none';
	/** A mailbox that is set up also offers "Aus dem Postfach wählen". */
	pick: boolean;
}

type ConnectionFacts = Pick<
	Connection,
	| 'type'
	| 'mailProvider'
	| 'label'
	| 'enabled'
	| 'secretEnv'
	| 'allowlistEnv'
	| 'lastRunAt'
	| 'lastOkAt'
	| 'lastError'
	| 'lastHint'
	| 'keywords'
	| 'github'
	| 'folders'
>;

/** What the tab knows beyond the server (KE-1, ADR-0076). */
export interface ChannelHealthContext {
	/** The user environment of the PC (BW-3); null or absent where the tab cannot read it. */
	stored?: StoredSecrets | null;
	/** The tab is another device of the administrator: the texts say "am PC". */
	remote?: boolean;
}

export function channelHealth(
	connection: ConnectionFacts,
	secretStatus: SecretStatus | null,
	running: boolean,
	helper: MailHelperStatus | null = null,
	context: ChannelHealthContext = {}
): ChannelHealth {
	const health = baseHealth(connection, secretStatus, running, helper, context);
	return {
		...health,
		pick:
			connection.type === 'mail' &&
			(health.state === 'ok' ||
				health.state === 'open' ||
				health.state === 'error' ||
				health.state === 'restart' ||
				health.state === 'running')
	};
}

function baseHealth(
	connection: ConnectionFacts,
	secretStatus: SecretStatus | null,
	running: boolean,
	helper: MailHelperStatus | null,
	context: ChannelHealthContext
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
			...CARD_STATUS.paused,
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
	const stored = context.stored ?? null;
	const remote = context.remote === true;
	const open = openSetupOf(setupKindOf(connection), { connection, secretStatus, stored });
	// Missing access data first, before the last error (GitHub reads public repositories without
	// its token, ADR-0050 §1: no open setup, only a hint below).
	if (open !== null && isSecretReason(open.reason)) {
		return {
			state: 'unset',
			...CARD_STATUS.setup,
			hint: openSetupHint(open, connection, secretStatus, remote),
			action: 'setup'
		};
	}
	const secret = secretStatusText(connection, secretStatus);
	const tokenless = secret !== null && !secret.ok && secretOptional(connection.type);
	if (connection.lastError !== '') {
		const hint = connection.lastHint !== '' ? ` ${connection.lastHint}` : '';
		return {
			state: 'error',
			...CARD_STATUS.error,
			hint: {
				tone: 'error',
				text: `${openStepPrefix(open)}Letzter Fehler: ${connection.lastError}${hint}`
			},
			action: regular
		};
	}
	// A mailbox needs the mail helper (ADR-0016 §4): if it does not run or runs with another token
	// or an old version, a restart of the app starts the right one (neu-starten.bat).
	if (connection.type === 'mail' && helper !== null && helper.state !== 'running') {
		return {
			state: 'restart',
			...CARD_STATUS.restart,
			hint: { tone: 'warning', text: `Hilfsprozess ${mailHelperText(helper)}` },
			action: regular
		};
	}
	// An open step of the setup (no first run yet, a chat that is not allowed, no repository or
	// folder, Notion not checked): never "Verbunden"; the main action stays the one of the card.
	if (open !== null) {
		return {
			state: 'open',
			...CARD_STATUS.setup,
			hint: openSetupHint(open, connection, secretStatus, remote),
			action: regular
		};
	}
	// The hint of the last run wins over the missing keywords: it may carry the chat ID Telegram
	// needs for the allowlist; the details still say "Stichwörter: keine".
	// Notion and GitHub have no keywords (ADR-0041, ADR-0050): the choice is the filter.
	let hint: ChannelHealth['hint'] = null;
	if (connection.lastHint !== '') hint = { tone: 'info', text: connection.lastHint };
	else if (tokenless) {
		// Known to be set on the PC (KE-1): it only waits for the restart, so not "Ohne Token".
		hint = {
			tone: 'info',
			text: stored?.secret === true ? OPEN_SETUP_TEXTS.tokenWaits : NO_TOKEN_HINT
		};
	} else if (connection.keywords.length === 0 && usesKeywords(connection.type)) {
		hint = { tone: 'warning', text: NO_KEYWORDS_WARNING };
	}
	return {
		state: 'ok',
		...CARD_STATUS.connected,
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
