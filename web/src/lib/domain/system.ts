// Page "Einstellungen → System" (ADR-0043): what the server reports about the app and its
// operation (status, checks, logs), the actions of the page, the refusals of the routes and the
// German texts. The server gets them from byl-control.ps1 (ADR-0039); the reasons for a restart
// read like the ones of status.bat (parity test with byl-control.ps1). Pure module: no requests,
// no runes.

import { formatBerlinDateTime } from './format';

export const SYSTEM_STATES = ['running', 'starting', 'unhealthy', 'stopped'] as const;
export type SystemState = (typeof SYSTEM_STATES)[number];

export const SYSTEM_VERDICTS = ['current', 'reload', 'restart'] as const;
export type SystemVerdict = (typeof SYSTEM_VERDICTS)[number];

export const RESTART_REASONS = [
	'unknown',
	'server',
	'migrations',
	'hooks',
	'port',
	'hosts',
	'lan',
	'environment',
	'mailHelper'
] as const;
export type RestartReason = (typeof RESTART_REASONS)[number];

export const AUTOSTART_STATES = ['on', 'off', 'other'] as const;
export type AutostartState = (typeof AUTOSTART_STATES)[number];

/** Why the mail helper does not run: '' when nothing speaks against it. */
export const MAIL_BLOCKERS = ['', 'not-installed', 'restart', 'no-mailbox'] as const;
export type MailBlocker = (typeof MAIL_BLOCKERS)[number];

export interface OtherServer {
	pid: number | null;
	path: string;
	port: number | null;
	/** The program of this folder with another data folder (a test instance). */
	sameFolder: boolean;
	/**
	 * A test instance: this program with another data folder, or a program in a worktree
	 * (…\byl-worktree…\) or a disposable copy of the tests (…\.tmp\). Folded on the page (RS-4).
	 */
	testInstance: boolean;
}

export const PROBLEM_LEVELS = ['error', 'warning'] as const;
export type ProblemLevel = (typeof PROBLEM_LEVELS)[number];

/**
 * An entry of the catalog of the scripts (app/byl-problems.ps1, ADR-0048) as the control script
 * reports it: what went wrong, why, and what helps, with the real paths of this machine.
 */
export interface ScriptProblemReport {
	code: string;
	level: ProblemLevel;
	exitCode: number;
	problem: string;
	/** Lines of this case under the problem, e.g. who uses the port. */
	facts: string[];
	cause: string;
	/** Steps and the command to copy ('' without one). */
	remedy: { steps: string[]; command: string };
	/** The log with the details, '' without one. */
	log: string;
}

/** The error of the last run without window (autostart, restart or restore from the app). */
export interface BackgroundProblem {
	/** When it happened (ISO 8601, UTC), null if unknown. */
	atUtc: string | null;
	/** The command of the run: start, restart, restore … */
	run: string;
	report: ScriptProblemReport;
}

export interface SystemStatus {
	state: SystemState;
	pid: number | null;
	port: number;
	/** Port in byl-config.json; differs from `port` until the next restart. */
	configuredPort: number;
	url: string;
	/** Start of the server (ISO 8601, UTC), null if unknown. */
	startedUtc: string | null;
	verdict: SystemVerdict;
	restartReasons: RestartReason[];
	/** The interface was built anew: F5 in the open tab is enough. */
	reload: boolean;
	mailHelperPid: number | null;
	otherServers: OtherServer[];
	autostart: AutostartState;
	/**
	 * The access in the home network (plan heimnetz): switched on in byl-config.json and the
	 * addresses under which other devices reach the running server now; null from a script of before.
	 */
	lan: { enabled: boolean; urls: string[] } | null;
	backgroundProblem: BackgroundProblem | null;
}

export interface SystemOverview {
	/** Folder of the app on the machine of the server. */
	appDir: string;
	status: SystemStatus;
	mail: { installed: boolean; running: boolean; blocker: MailBlocker };
}

export const DOCTOR_LEVELS = ['ok', 'warning', 'error', 'info'] as const;
export type DoctorLevel = (typeof DOCTOR_LEVELS)[number];

export interface DoctorCheck {
	name: string;
	level: DoctorLevel;
	text: string;
	/** The entry of the catalog for a check that found a problem, else null. */
	report: ScriptProblemReport | null;
}

export interface DoctorResult {
	ok: boolean;
	checks: DoctorCheck[];
}

export const LOG_SETS = ['server', 'mail', 'skript'] as const;
export type LogSetName = (typeof LOG_SETS)[number];

export interface LogFile {
	file: string;
	exists: boolean;
	sizeBytes: number;
	modifiedUtc: string | null;
	lines: string[];
}

export interface LogSet {
	name: LogSetName;
	files: LogFile[];
}

export interface SystemLogs {
	/** Lines per file at most. */
	lines: number;
	logs: LogSet[];
}

/** The actions of the page, each a fixed command on the server (whitelist of the route). */
export const SYSTEM_ACTIONS = ['restart', 'mail-restart', 'autostart-on', 'autostart-off'] as const;
export type SystemAction = (typeof SYSTEM_ACTIONS)[number];

/**
 * Why a route refused: the reasons of the server, plus `missing` (no route yet: the server runs a
 * version from before the update) and `forbidden` (403 without reason, e.g. an admin account).
 */
export const SYSTEM_DENIALS = [
	'platform',
	'loopback',
	'origin',
	'owner',
	'rate',
	'unavailable',
	'busy',
	'script',
	'unknown',
	'missing',
	'forbidden'
] as const;
export type SystemDenial = (typeof SYSTEM_DENIALS)[number];

/** The reasons for a restart, in the words of status.bat (byl-control.ps1, $RestartReasonText). */
export const RESTART_REASON_LABELS: Readonly<Record<RestartReason, string>> = {
	unknown: 'Startstand unbekannt (gestartet ohne diese Skripte)',
	server: 'neue PocketBase-Version (pocketbase.exe)',
	migrations: 'neue oder geänderte Migration',
	hooks: 'geänderte Server-Logik (pb_hooks)',
	port: 'anderer Port eingestellt (byl-config.json)',
	hosts: 'andere zusätzliche Adressen eingestellt (byl-config.json)',
	lan: 'Zugriff im Heimnetz geändert (byl-config.json)',
	environment: 'BYL_*-Variable angelegt, geändert oder entfernt',
	mailHelper: 'neuer Mail-Hilfsprozess (byl-mail.exe)'
};

export const LOG_SET_LABELS: Readonly<Record<LogSetName, string>> = {
	server: 'Server',
	mail: 'Mail-Helfer',
	skript: 'Skript'
};

export const DOCTOR_LEVEL_LABELS: Readonly<Record<DoctorLevel, string>> = {
	ok: 'In Ordnung',
	warning: 'Warnung',
	error: 'Fehler',
	info: 'Hinweis'
};

export interface SystemNotice {
	title: string;
	text: string;
}

/** What the page says instead of its content when the route refuses. */
export const DENIAL_TEXTS: Readonly<Record<Exclude<SystemDenial, 'missing'>, SystemNotice>> = {
	platform: {
		title: 'Nur für einen Server unter Windows',
		text: 'Die Seite System bedient die Skripte im Ordner app unter Windows. Dein Server läuft unter Linux oder in einem Container; der Ausbau für diese Systeme ist zurückgestellt.'
	},
	loopback: {
		title: 'Nur auf dem Rechner der App',
		text: 'Diese Seite geht nur im Browser auf dem Rechner, auf dem becauseyoulovejira läuft, nicht von einem anderen Gerät und nicht über einen Proxy.'
	},
	origin: {
		title: 'Nur unter der Adresse der App',
		text: 'Öffne die App unter ihrer eigenen Adresse auf diesem Rechner, etwa http://127.0.0.1:8090/, und versuche es dort erneut.'
	},
	owner: {
		title: 'Nur für den Besitzer dieser Installation',
		text: 'Die App bedienen darf nur das App-Konto, das bei der Einrichtung zuerst angelegt wurde. Melde dich mit diesem Konto an.'
	},
	rate: {
		title: 'Zu viele Anfragen',
		text: 'Warte eine Minute und versuche es dann erneut.'
	},
	unavailable: {
		title: 'Steuerung hier nicht verfügbar',
		text: 'Dieser Server läuft nicht als App aus ihrem Ordner app mit byl-control.ps1, etwa als Test- oder Entwicklungsinstanz. Nutze dort die Skripte direkt.'
	},
	busy: {
		title: 'Eine Aktion läuft gerade',
		text: 'Warte, bis sie fertig ist, und versuche es dann erneut.'
	},
	script: {
		title: 'Das Steuerskript hat nicht wie erwartet geantwortet',
		text: 'Versuche es erneut. Hilft das nicht, zeigt status.bat im Ordner app den Zustand; Einzelheiten stehen in app\\logs.'
	},
	unknown: {
		title: 'Diese Aktion gibt es nicht',
		text: 'Lade die Seite neu; vielleicht ist die App gerade aktualisiert worden.'
	},
	forbidden: {
		title: 'Mit diesem Konto nicht möglich',
		text: 'Melde dich mit deinem App-Konto an, nicht mit dem Admin-Konto.'
	}
};

/** Texts of the restart (confirmation, progress and result). */
export const RESTART_TEXTS = {
	confirmTitle: 'becauseyoulovejira jetzt neu starten?',
	confirm:
		'Der Server wird geordnet beendet und neu gestartet. Die App ist dabei einige Sekunden nicht erreichbar; offene Tabs verbinden sich danach von selbst wieder.',
	unsaved:
		'Speichere vorher Eingaben in anderen Tabs: Was während des Neustarts gespeichert wird, geht nicht durch.',
	confirmLabel: 'Neu starten',
	runningTitle: 'Neustart läuft …',
	stopping: 'Der Server wird geordnet beendet.',
	starting: 'Der Server startet wieder.',
	done: 'becauseyoulovejira wurde neu gestartet.',
	failedTitle: 'Die App antwortet nach dem Neustart nicht',
	failed:
		'Starte sie mit start.bat im Ordner app. Was passiert ist, steht in app\\logs\\byl-control.log.',
	notStartedTitle: 'Der Neustart hat nicht begonnen',
	notStarted: 'Einzelheiten stehen in app\\logs\\byl-control.log. Versuche es erneut.'
} as const;

/** The reason of a refusal from the HTTP status and the `reason` of the answer. */
export function denialOf(status: number, reason: unknown): SystemDenial {
	if (typeof reason === 'string' && (SYSTEM_DENIALS as readonly string[]).includes(reason)) {
		return reason as SystemDenial;
	}
	if (status === 404) return 'missing';
	if (status === 403) return 'forbidden';
	if (status === 429) return 'rate';
	if (status === 409) return 'busy';
	return 'script';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function count(value: unknown): number | null {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function textOf(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

function oneOf<T extends string>(list: readonly T[], value: unknown): value is T {
	return typeof value === 'string' && (list as readonly string[]).includes(value);
}

function texts(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === 'string' && item !== '')
		: [];
}

/** An entry of the catalog of the scripts as the server passes it on, or null. */
export function parseProblemReport(raw: unknown): ScriptProblemReport | null {
	if (!isRecord(raw) || !oneOf(PROBLEM_LEVELS, raw.level)) return null;
	const code = textOf(raw.code);
	const problem = textOf(raw.problem);
	if (code === '' || problem === '') return null;
	const remedy = isRecord(raw.remedy) ? raw.remedy : {};
	return {
		code,
		level: raw.level,
		exitCode: count(raw.exitCode) ?? 1,
		problem,
		facts: texts(raw.facts),
		cause: textOf(raw.cause),
		remedy: { steps: texts(remedy.steps), command: textOf(remedy.command) },
		log: textOf(raw.log)
	};
}

function parseBackgroundProblem(raw: unknown): BackgroundProblem | null {
	if (!isRecord(raw)) return null;
	const report = parseProblemReport(raw.report);
	if (report === null) return null;
	return { atUtc: textOf(raw.atUtc) || null, run: textOf(raw.run), report };
}

function parseStatus(raw: unknown): SystemStatus | null {
	if (!isRecord(raw)) return null;
	const port = count(raw.port);
	if (!oneOf(SYSTEM_STATES, raw.state) || !oneOf(SYSTEM_VERDICTS, raw.verdict) || port === null) {
		return null;
	}
	const reasons = Array.isArray(raw.restartReasons) ? raw.restartReasons : [];
	const servers = Array.isArray(raw.otherServers) ? raw.otherServers : [];
	return {
		state: raw.state,
		pid: count(raw.pid),
		port,
		configuredPort: count(raw.configuredPort) ?? port,
		url: textOf(raw.url),
		startedUtc: textOf(raw.startedUtc) || null,
		verdict: raw.verdict,
		restartReasons: reasons.filter((reason): reason is RestartReason =>
			oneOf(RESTART_REASONS, reason)
		),
		reload: raw.reload === true,
		mailHelperPid: count(raw.mailHelperPid),
		otherServers: servers.filter(isRecord).map((server) => ({
			pid: count(server.pid),
			path: textOf(server.path),
			port: count(server.port),
			sameFolder: server.sameFolder === true,
			testInstance: server.testInstance === true || server.sameFolder === true
		})),
		autostart: oneOf(AUTOSTART_STATES, raw.autostart) ? raw.autostart : 'off',
		lan: isRecord(raw.lan)
			? { enabled: raw.lan.enabled === true, urls: texts(raw.lan.urls) }
			: null,
		backgroundProblem: parseBackgroundProblem(raw.backgroundProblem)
	};
}

/** The answer of GET /api/byl/system (and of the actions), or null. */
export function parseOverview(raw: unknown): SystemOverview | null {
	if (!isRecord(raw) || !isRecord(raw.mail)) return null;
	const status = parseStatus(raw.status);
	if (status === null) return null;
	return {
		appDir: textOf(raw.appDir),
		status,
		mail: {
			installed: raw.mail.installed === true,
			running: raw.mail.running === true,
			blocker: oneOf(MAIL_BLOCKERS, raw.mail.blocker) ? raw.mail.blocker : ''
		}
	};
}

/** The answer of GET /api/byl/system/doctor, or null. */
export function parseDoctor(raw: unknown): DoctorResult | null {
	if (!isRecord(raw) || !Array.isArray(raw.checks)) return null;
	const checks = raw.checks.filter(isRecord).flatMap((check): DoctorCheck[] =>
		oneOf(DOCTOR_LEVELS, check.level) && typeof check.text === 'string'
			? [
					{
						name: textOf(check.name),
						level: check.level,
						text: check.text,
						report: parseProblemReport(check.report)
					}
				]
			: []
	);
	return { ok: raw.ok === true, checks };
}

/** The answer of GET /api/byl/system/logs, or null. */
export function parseLogs(raw: unknown): SystemLogs | null {
	if (!isRecord(raw) || !Array.isArray(raw.logs)) return null;
	const logs = raw.logs.filter(isRecord).flatMap((set): LogSet[] => {
		if (!oneOf(LOG_SETS, set.name) || !Array.isArray(set.files)) return [];
		const files = set.files.filter(isRecord).flatMap((file): LogFile[] =>
			typeof file.file === 'string'
				? [
						{
							file: file.file,
							exists: file.exists === true,
							sizeBytes: count(file.sizeBytes) ?? 0,
							modifiedUtc: textOf(file.modifiedUtc) || null,
							lines: Array.isArray(file.lines)
								? file.lines.filter((line): line is string => typeof line === 'string')
								: []
						}
					]
				: []
		);
		return [{ name: set.name, files }];
	});
	return { lines: count(raw.lines) ?? 0, logs };
}

/**
 * A point in time of the control script (ISO 8601 with up to 7 decimals, UTC) as Berlin time
 * "TT.MM.JJJJ HH:MM", or '' if it is none.
 */
export function formatPointInTime(iso: string | null): string {
	const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z$/.exec(iso ?? '');
	if (match === null) return '';
	const fraction = (match[3] ?? '').slice(0, 3);
	try {
		return formatBerlinDateTime(`${match[1]} ${match[2]}${fraction === '' ? '' : `.${fraction}`}Z`);
	} catch {
		return '';
	}
}

/** "Läuft seit 30.09.2026 01:23" and the other states of the server. */
export function stateText(status: SystemStatus): string {
	switch (status.state) {
		case 'running': {
			const since = formatPointInTime(status.startedUtc);
			return since === '' ? 'Läuft' : `Läuft seit ${since}`;
		}
		case 'starting':
			return 'Startet gerade';
		case 'unhealthy':
			return 'Läuft, antwortet aber nicht';
		default:
			return 'Läuft nicht';
	}
}

/** The runs without window whose error the control script keeps (ADR-0048 §4), in words. */
const BACKGROUND_RUNS: ReadonlyMap<string, string> = new Map([
	['start', 'Start ohne Fenster (Autostart)'],
	['restart', 'Neustart aus der App'],
	['restore', 'Wiederherstellung aus der App']
]);

/** "Start ohne Fenster (Autostart) am 02.10.2026 07:00": which run failed and when. */
export function backgroundRunText(problem: BackgroundProblem): string {
	const run =
		BACKGROUND_RUNS.get(problem.run) ??
		(problem.run === '' ? 'Lauf ohne Fenster' : `Lauf ohne Fenster (${problem.run})`);
	const when = formatPointInTime(problem.atUtc);
	return when === '' ? run : `${run} am ${when}`;
}

/** Whether a restart is needed now: an update waits for it, or the server does not answer. */
export function restartNeeded(status: SystemStatus): boolean {
	return status.verdict === 'restart' || status.state === 'unhealthy';
}

/** "Aktuell", "F5 genügt …" or "Neustart nötig: <reasons>". */
export function verdictText(status: SystemStatus): string {
	if (status.verdict === 'restart') {
		const reasons = status.restartReasons.map((reason) => RESTART_REASON_LABELS[reason]);
		return reasons.length === 0 ? 'Neustart nötig' : `Neustart nötig: ${reasons.join(', ')}`;
	}
	if (status.verdict === 'reload') {
		return 'Oberfläche neu gebaut: F5 im offenen Tab genügt';
	}
	return 'Aktuell';
}

/** State of the mail helper and, if it does not run, why. */
export function mailText(overview: SystemOverview): { label: string; hint: string } {
	if (overview.mail.running) return { label: 'Läuft', hint: '' };
	switch (overview.mail.blocker) {
		case 'not-installed':
			return {
				label: 'Nicht installiert',
				hint: 'byl-mail.exe fehlt im Ordner app; gebraucht wird er nur für Postfächer.'
			};
		case 'restart':
			return {
				label: 'Läuft nicht',
				hint: 'Er startet erst nach einem Neustart der App.'
			};
		case 'no-mailbox':
			return {
				label: 'Läuft nicht',
				hint: 'Kein Postfach ist eingeschaltet; er wird nicht gebraucht.'
			};
		default:
			return {
				label: 'Läuft nicht',
				hint: '„Mail-Helfer neu starten“ versucht es erneut; Einzelheiten stehen im Log „Mail-Helfer“.'
			};
	}
}

export const AUTOSTART_TEXTS: Readonly<Record<AutostartState, string>> = {
	on: 'An',
	off: 'Aus',
	other: 'Zeigt auf einen anderen Ordner'
};

function otherServerKind(server: OtherServer): string {
	if (server.sameFolder) return 'Test-Instanz dieses Ordners';
	return server.testInstance ? 'Test-Instanz' : 'Andere Kopie';
}

/** "Andere Kopie auf Port 8091 · C:\…\pocketbase.exe" for another copy of the app. */
export function otherServerText(server: OtherServer): string {
	const where = server.port === null ? 'andere Adresse' : `Port ${server.port}`;
	const kind = otherServerKind(server);
	return server.path === '' ? `${kind} auf ${where}` : `${kind} auf ${where} · ${server.path}`;
}

/** Real second installations (shown) and test instances (folded), in the order of the script. */
export function groupOtherServers(servers: readonly OtherServer[]): {
	copies: OtherServer[];
	tests: OtherServer[];
} {
	return {
		copies: servers.filter((server) => !server.testInstance),
		tests: servers.filter((server) => server.testInstance)
	};
}

/** "1 Test-Instanz (Entwicklung)" or "3 Test-Instanzen (Entwicklung)". */
export function testInstancesText(count: number): string {
	return `${count} ${count === 1 ? 'Test-Instanz' : 'Test-Instanzen'} (Entwicklung)`;
}

/** Size of a log file as "12 KB" (at least 1 KB for a file with content). */
export function sizeText(bytes: number): string {
	if (bytes <= 0) return '0 KB';
	const kilobytes = Math.ceil(bytes / 1024);
	if (kilobytes < 1024) return `${kilobytes} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}
