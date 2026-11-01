// Return to the step of a setup assistant (BW-1, ADR-0072): what one tab keeps of an open assistant
// in sessionStorage, so after a restart of the app, a reload of the page or the next opening in the
// same tab it stands at the same step, with the inputs of the step "Verbinden" from before the
// connection existed. Pure: the keys, the form of an entry, reading with expiry and the check of the
// form, and writing; since KE-1 (ADR-0076) which setups of the tab are begun before a connection.
// Never a secret: an entry holds the step, the time, the mark of a restart started from the step
// and only the fields of SetupConnectInputs, none of which takes the value of a variable. Even
// there, a text that looks like an access token is left out, and the names of the variables are
// kept only in their own form (BYL_…). What is typed into "Wert hier einsetzen" never reaches this
// module (SecretValueField keeps it in its own state).

import { GUIDE_KINDS, SETUP_KINDS, setupStepKey, type SetupKind } from './channel-setup';
import {
	LABEL_MAX_LENGTH,
	MAIL_USER_MAX_LENGTH,
	isSecretName,
	type ConnectionType
} from './connections';
import type { FolderDraft } from './folders';
import type { GitHubRepoDraft } from './github';

/** Prefix of every key of the assistants in sessionStorage. */
export const SETUP_RESUME_PREFIX = 'byl-setup:';

/**
 * An entry counts for two hours after it was last written: a setup with getting a token at the
 * provider, a variable and a restart takes minutes, rarely an hour, so a break fits; a tab left
 * open until the next day starts again from the facts of the server.
 */
export const SETUP_RESUME_TTL_MS = 2 * 60 * 60 * 1000;

/** More steps than any assistant has; a larger number is no entry of the app. */
const MAX_STEP = 20;
/** Clocks may differ a little; an entry from further in the future is broken. */
const FUTURE_SLACK_MS = 60_000;
/** Longest text of a field with several lines (patterns, types). */
const TEXT_MAX = 4000;
const REPO_MAX = 300;
const PATH_MAX = 400;
const RECORD_ID = /^[a-z0-9]{15}$/;

/** Key of an assistant: `byl-setup:<id>` of its connection, before there is one `byl-setup:neu:<art>`. */
export function setupResumeKey(kind: SetupKind, connectionId: string | null): string {
	return connectionId === null ? `${SETUP_RESUME_PREFIX}neu:${kind}` : setupStepKey(connectionId);
}

/** The inputs of the step "Verbinden" before the connection exists; none takes a secret. */
export interface SetupConnectInputs {
	label: string;
	mailUser: string;
	/** Names of the variables, never their values. */
	secretEnv: string;
	allowlistEnv: string;
	githubAuto: boolean;
	/** GitHub: the first repository. */
	repo: GitHubRepoDraft | null;
	/** Folders: the first folder. */
	folder: FolderDraft | null;
}

export interface SetupResume {
	/** Index of the step. */
	step: number;
	/** When it was written, ms since the epoch. */
	savedAt: number;
	/** A restart was started from this step: the assistant opens exactly there again. */
	restart: boolean;
	connect: SetupConnectInputs | null;
}

const SECRET_LIKE: readonly RegExp[] = [
	/\beyJ[\w-]+\.[\w-]+\.[\w-]+/,
	/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,})/,
	/\b(?:ntn|secret)_[A-Za-z0-9]{20,}/,
	/\b\d{6,}:[\w-]{30,}/,
	/\bbyl_[A-Za-z0-9]{40}\b/,
	/\/calendar\/ical\/\S*\/private-/i,
	/^(?=\S*\d)(?=\S*[A-Za-z])[\w+=.-]{32,}$/
];

/**
 * Whether `text` looks like an access token, so it is never stored, whatever field it was typed
 * into: a JWT, a token of GitHub, Notion or a Telegram bot, a key of the own inbox, the private
 * iCal address of Google, or one long word of letters and digits.
 */
export function looksLikeSecret(text: string): boolean {
	const value = text.trim();
	return SECRET_LIKE.some((pattern) => pattern.test(value));
}

function safeText(value: string, max: number): string {
	return value.length <= max && !looksLikeSecret(value) ? value : '';
}

function safeName(value: string): string {
	return isSecretName(value.trim()) ? value.trim() : '';
}

function cleanRepo(repo: GitHubRepoDraft): GitHubRepoDraft {
	return {
		input: safeText(repo.input, REPO_MAX),
		pathsText: safeText(repo.pathsText, TEXT_MAX),
		docs: repo.docs,
		events: { files: repo.events.files, pulls: repo.events.pulls, releases: repo.events.releases },
		target: repo.target !== null && RECORD_ID.test(repo.target) ? repo.target : null
	};
}

function cleanFolder(folder: FolderDraft): FolderDraft {
	return {
		path: safeText(folder.path, PATH_MAX),
		subfolders: folder.subfolders,
		typesText: safeText(folder.typesText, TEXT_MAX),
		excludeText: safeText(folder.excludeText, TEXT_MAX),
		target: folder.target !== null && RECORD_ID.test(folder.target) ? folder.target : null,
		reportChanges: folder.reportChanges
	};
}

/** The inputs as they may be kept: every text once more without anything token-like. */
function cleanConnect(inputs: SetupConnectInputs): SetupConnectInputs {
	return {
		label: safeText(inputs.label, LABEL_MAX_LENGTH),
		mailUser: safeText(inputs.mailUser, MAIL_USER_MAX_LENGTH),
		secretEnv: safeName(inputs.secretEnv),
		allowlistEnv: safeName(inputs.allowlistEnv),
		githubAuto: inputs.githubAuto,
		repo: inputs.repo === null ? null : cleanRepo(inputs.repo),
		folder: inputs.folder === null ? null : cleanFolder(inputs.folder)
	};
}

/**
 * The inputs of the form "Verbinden" to keep: GitHub keeps its first repository, folders their
 * first folder, every other kind neither. It reads every field, so an effect follows them all.
 */
export function connectInputsOf(
	type: ConnectionType,
	draft: { label: string; mailUser: string; secretEnv: string; allowlistEnv: string },
	githubAuto: boolean,
	repo: GitHubRepoDraft,
	folder: FolderDraft
): SetupConnectInputs {
	return cleanConnect({
		label: draft.label,
		mailUser: draft.mailUser,
		secretEnv: draft.secretEnv,
		allowlistEnv: draft.allowlistEnv,
		githubAuto: type === 'github' && githubAuto,
		repo: type === 'github' ? repo : null,
		folder: type === 'folder' ? folder : null
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isText = (value: unknown, max: number): value is string =>
	typeof value === 'string' && value.length <= max && !looksLikeSecret(value);
const isFlag = (value: unknown): value is boolean => typeof value === 'boolean';
const isTarget = (value: unknown): value is string | null =>
	value === null || (typeof value === 'string' && RECORD_ID.test(value));
const isName = (value: unknown): value is string =>
	value === '' || (typeof value === 'string' && isSecretName(value));
const isStep = (value: unknown): value is number =>
	typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_STEP;

function toRepo(value: unknown): GitHubRepoDraft | null | undefined {
	if (value === null) return null;
	if (!isRecord(value) || !isRecord(value.events)) return undefined;
	const { input, pathsText, docs, target } = value;
	const { files, pulls, releases } = value.events;
	if (!isText(input, REPO_MAX) || !isText(pathsText, TEXT_MAX) || !isTarget(target)) {
		return undefined;
	}
	if (!isFlag(docs) || !isFlag(files) || !isFlag(pulls) || !isFlag(releases)) return undefined;
	return { input, pathsText, docs, events: { files, pulls, releases }, target };
}

function toFolder(value: unknown): FolderDraft | null | undefined {
	if (value === null) return null;
	if (!isRecord(value)) return undefined;
	const { path, subfolders, typesText, excludeText, target, reportChanges } = value;
	if (!isText(path, PATH_MAX) || !isText(typesText, TEXT_MAX) || !isText(excludeText, TEXT_MAX)) {
		return undefined;
	}
	if (!isFlag(subfolders) || !isFlag(reportChanges) || !isTarget(target)) return undefined;
	return { path, subfolders, typesText, excludeText, target, reportChanges };
}

function toConnect(value: unknown): SetupConnectInputs | null | undefined {
	if (value === undefined) return null;
	if (!isRecord(value)) return undefined;
	const { label, mailUser, secretEnv, allowlistEnv, githubAuto } = value;
	const repo = toRepo(value.repo);
	const folder = toFolder(value.folder);
	if (repo === undefined || folder === undefined || !isFlag(githubAuto)) return undefined;
	if (!isText(label, LABEL_MAX_LENGTH) || !isText(mailUser, MAIL_USER_MAX_LENGTH)) return undefined;
	if (!isName(secretEnv) || !isName(allowlistEnv)) return undefined;
	return { label, mailUser, secretEnv, allowlistEnv, githubAuto, repo, folder };
}

/**
 * The entry stored under a key, or null when there is none, it is broken (no JSON, another form,
 * a step out of range, a text that looks like a token) or expired. The form before BW-1, only the
 * number of the step, still counts as that step without inputs.
 */
export function parseSetupResume(stored: string | null, now: number): SetupResume | null {
	if (stored === null) return null;
	let value: unknown;
	try {
		value = JSON.parse(stored);
	} catch {
		return null;
	}
	if (isStep(value)) return { step: value, savedAt: now, restart: false, connect: null };
	if (!isRecord(value) || value.v !== 1 || !isStep(value.step)) return null;
	const { savedAt, restart } = value;
	if (typeof savedAt !== 'number' || !Number.isInteger(savedAt)) return null;
	if (now - savedAt > SETUP_RESUME_TTL_MS || savedAt - now > FUTURE_SLACK_MS) return null;
	if (restart !== undefined && restart !== true) return null;
	const connect = toConnect(value.connect);
	if (connect === undefined) return null;
	return { step: value.step, savedAt, restart: restart === true, connect };
}

/** The entry as stored: only its known fields, the inputs without anything token-like. */
export function serializeSetupResume(entry: SetupResume): string {
	return JSON.stringify({
		v: 1,
		step: entry.step,
		savedAt: entry.savedAt,
		...(entry.restart ? { restart: true } : {}),
		...(entry.connect === null ? {} : { connect: cleanConnect(entry.connect) })
	});
}

/**
 * Whether the entry under a key of the assistants can go: broken or expired. The form before
 * BW-1 stays, it carries no time; the next step of its assistant writes it anew.
 */
export function isStaleSetupResume(stored: string | null, now: number): boolean {
	return stored !== null && parseSetupResume(stored, now) === null;
}

/** Prefix of the entries of an assistant before its connection exists. */
const BEGUN_PREFIX = `${SETUP_RESUME_PREFIX}neu:`;

/**
 * The setups of this tab begun before their connection existed (KE-1, ADR-0076 §5): every valid
 * entry `byl-setup:neu:<art>` of an assistant with steps (not Proton or WhatsApp Web), read from
 * the pairs of key and value of sessionStorage, in the order of SETUP_KINDS; and the keys of broken
 * or expired entries of every assistant, which the reader removes as opening an assistant does.
 * The model of BW-1 stays (sessionStorage, two hours, ADR-0072 §4): nothing new is stored.
 */
export function begunSetups(
	entries: Iterable<readonly [string, string | null]>,
	now: number
): { kinds: SetupKind[]; stale: string[] } {
	const begun = new Set<string>();
	const stale: string[] = [];
	for (const [key, value] of entries) {
		if (!key.startsWith(SETUP_RESUME_PREFIX)) continue;
		if (isStaleSetupResume(value, now)) {
			stale.push(key);
			continue;
		}
		if (key.startsWith(BEGUN_PREFIX) && parseSetupResume(value, now) !== null) {
			begun.add(key.slice(BEGUN_PREFIX.length));
		}
	}
	const kinds = SETUP_KINDS.filter((kind) => begun.has(kind) && !GUIDE_KINDS.includes(kind));
	return { kinds, stale };
}

/** Text of a step with "Wert hier einsetzen" after a reload or a restart (BW-1). */
export const SECRET_NOT_KEPT =
	'Was du unter „Wert hier einsetzen“ eingetragen hattest, ist nicht mehr da: Die App speichert solche Werte nie, auch nicht für einen Neustart oder ein Neuladen der Seite. Füge den Wert bei Bedarf erneut ein.';
