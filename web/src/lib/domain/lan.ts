// Access in the home network (plan docs/plan/heimnetz.md, ADR-0055 addendum): the answers of the
// routes /api/byl/security/lan… read strictly, the rule of the addresses (the same as
// normalizeLanAddress of app/pb_hooks/lib/lan-rules.js and ConvertTo-BylLanAddress of
// app/byl-functions.ps1, parity tests) and the words of the page "Sicherheit". Pure module; the
// server decides, the page only words it.

import { parseProblemReport, type ScriptProblemReport } from './system';

/** At most this many addresses (LAN_MAX of lan-rules.js). */
export const LAN_MAX = 5;
const OCTET = '(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])';
const IPV4 = new RegExp(`^${OCTET}\\.${OCTET}\\.${OCTET}\\.${OCTET}$`);
const LAN_NAME =
	/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:fritz\.box|local|lan|home\.arpa|internal)$/;

/** Display name of the inbound rule of the Windows firewall (RULE_NAME of lan-rules.js). */
export const LAN_RULE_NAME = 'becauseyoulovejira (Heimnetz)';

export const NETWORK_CATEGORIES = ['private', 'public', 'domain', 'unknown'] as const;
export type NetworkCategory = (typeof NETWORK_CATEGORIES)[number];
export const FIREWALL_STATES = ['present', 'missing', 'mismatch', 'unknown'] as const;
export type FirewallState = (typeof FIREWALL_STATES)[number];
export const FIREWALL_ACTIONS = ['add', 'remove'] as const;
export type FirewallAction = (typeof FIREWALL_ACTIONS)[number];
const OUTCOMES = ['done', 'test', 'cancelled', 'failed', 'timeout'] as const;
export type FirewallOutcome = (typeof OUTCOMES)[number];

/** Whether `value` is an IPv4 address in 10.0.0.0/8, 172.16.0.0/12 or 192.168.0.0/16. */
export function isPrivateIPv4(value: unknown): boolean {
	const match = IPV4.exec(typeof value === 'string' ? value : '');
	if (match === null) return false;
	const first = Number(match[1]);
	const second = Number(match[2]);
	return (
		first === 10 ||
		(first === 172 && second >= 16 && second <= 31) ||
		(first === 192 && second === 168)
	);
}

/** `value` trimmed and in lower case if it is an address of the home network, otherwise ''. */
export function normalizeLanAddress(value: unknown): string {
	const address = typeof value === 'string' ? value.trim().toLowerCase() : '';
	return isPrivateIPv4(address) || LAN_NAME.test(address) ? address : '';
}

/** An address of this computer the page offers. */
export interface LanCandidate {
	address: string;
	/** An IPv4 address or the name of the computer in the home network (e.g. …fritz.box). */
	kind: 'ip' | 'name';
	/** The network adapter, e.g. "Ethernet" or "WLAN". */
	adapter: string;
	category: NetworkCategory;
}

/** A chosen address now: on an adapter of this computer (null for a name) and its network. */
export interface LanAddressState {
	address: string;
	present: boolean | null;
	adapter: string;
	category: NetworkCategory;
}

/** What GET /api/byl/security/lan reports (byl-control.ps1 lan-info). */
export interface LanInfo {
	port: number;
	/** Switched on in byl-config.json (it applies after a restart). */
	enabled: boolean;
	addresses: readonly string[];
	max: number;
	/** Whether Windows told the addresses of the computer. */
	network: boolean;
	candidates: readonly LanCandidate[];
	states: readonly LanAddressState[];
	firewall: {
		state: FirewallState;
		/** A block rule of the firewall wins over every allow rule. */
		blocked: boolean;
		rule: string;
		/** The commands to change the rule by hand, with the paths of this machine. */
		add: string;
		remove: string;
	};
}

/** The home network in GET /api/byl/security: what the running server allows. */
export interface LanOverview {
	/** The server listens on every address of the computer (started with the home network on). */
	active: boolean;
	/** The hosts of the home network it answers under, e.g. "192.168.178.20:8090". */
	hosts: readonly string[];
	/** The control script of the own instance can change the setting (Windows, folder app). */
	editable: boolean;
	/** False before the restart after the update (the server does not tell yet). */
	ready: boolean;
}

/** The result of POST /api/byl/security/lan/firewall. */
export interface FirewallResult {
	ok: boolean;
	action: FirewallAction;
	outcome: FirewallOutcome | '';
	/** The entry of the catalog of the scripts when the change did not happen. */
	report: ScriptProblemReport | null;
}

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function oneOf<T extends string>(list: readonly T[], value: unknown): value is T {
	return typeof value === 'string' && (list as readonly string[]).includes(value);
}

function addresses(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.map(normalizeLanAddress).filter((address) => address !== '');
}

function category(value: unknown): NetworkCategory {
	return oneOf(NETWORK_CATEGORIES, value) ? value : 'unknown';
}

function candidate(value: unknown): LanCandidate | null {
	if (!isRecord(value) || (value.kind !== 'ip' && value.kind !== 'name')) return null;
	const address = normalizeLanAddress(value.address);
	if (address === '') return null;
	return {
		address,
		kind: value.kind,
		adapter: typeof value.adapter === 'string' ? value.adapter : '',
		category: category(value.category)
	};
}

function addressState(value: unknown): LanAddressState | null {
	if (!isRecord(value)) return null;
	const address = normalizeLanAddress(value.address);
	if (address === '') return null;
	return {
		address,
		present: typeof value.present === 'boolean' ? value.present : null,
		adapter: typeof value.adapter === 'string' ? value.adapter : '',
		category: category(value.category)
	};
}

function listOf<T>(value: unknown, read: (entry: unknown) => T | null): T[] {
	if (!Array.isArray(value)) return [];
	return value.map(read).filter((entry): entry is T => entry !== null);
}

/** The state of the home network of an answer `{ lan: … }`, or null for anything else. */
export function parseLanInfo(value: unknown): LanInfo | null {
	const raw = isRecord(value) ? value.lan : null;
	if (!isRecord(raw) || !isCount(raw.port) || !isRecord(raw.firewall)) return null;
	const { firewall } = raw;
	return {
		port: raw.port,
		enabled: raw.enabled === true,
		addresses: addresses(raw.addresses),
		max: isCount(raw.max) ? raw.max : LAN_MAX,
		network: raw.network === true,
		candidates: listOf(raw.candidates, candidate),
		states: listOf(raw.states, addressState),
		firewall: {
			state: oneOf(FIREWALL_STATES, firewall.state) ? firewall.state : 'unknown',
			blocked: firewall.blocked === true,
			rule: LAN_RULE_NAME,
			add: typeof firewall.add === 'string' ? firewall.add : '',
			remove: typeof firewall.remove === 'string' ? firewall.remove : ''
		}
	};
}

/** The home network of the overview; before the restart after the update the server sends none. */
export function parseLanOverview(value: unknown): LanOverview {
	if (!isRecord(value)) return { active: false, hosts: [], editable: false, ready: false };
	const hosts = Array.isArray(value.hosts)
		? value.hosts.filter((host): host is string => typeof host === 'string' && host !== '')
		: [];
	return { active: value.active === true, hosts, editable: value.editable === true, ready: true };
}

/** The answer of POST /api/byl/security/lan/firewall: the result and the state after it. */
export function parseFirewallAnswer(
	value: unknown
): { result: FirewallResult; lan: LanInfo | null } | null {
	if (!isRecord(value) || !isRecord(value.result)) return null;
	const { result } = value;
	if (typeof result.ok !== 'boolean' || !oneOf(FIREWALL_ACTIONS, result.action)) return null;
	return {
		result: {
			ok: result.ok,
			action: result.action,
			outcome: oneOf(OUTCOMES, result.outcome) ? result.outcome : '',
			report: result.ok ? null : parseProblemReport(result.report)
		},
		lan: parseLanInfo(value)
	};
}

/** The address of the app for other devices under `host` ("192.168.178.20:8090"). */
export function lanUrl(host: string): string {
	return `http://${host}/`;
}

/** The addresses for other devices: those the server answers under now, else the chosen ones. */
export function lanUrls(overview: LanOverview, info: LanInfo | null): string[] {
	if (overview.active && overview.hosts.length > 0) return overview.hosts.map(lanUrl);
	if (info === null || !info.enabled) return [];
	return info.addresses.map((address) => lanUrl(`${address}:${info.port}`));
}

/** Whether the setting differs from what the running server does (a restart is needed). */
export function lanRestartNeeded(overview: LanOverview, info: LanInfo | null): boolean {
	if (info === null || !overview.ready) return false;
	const wanted = info.enabled
		? info.addresses.map((address) => `${address}:${info.port}`).sort()
		: [];
	const running = overview.active ? [...overview.hosts].sort() : [];
	return wanted.length !== running.length || wanted.some((host, index) => host !== running[index]);
}

/** Whether two lists hold the same addresses (order does not matter). */
export function sameAddresses(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((address) => b.includes(address));
}

// --- Words of the page --------------------------------------------------------------------------

export const CATEGORY_LABELS: Readonly<Record<NetworkCategory, string>> = {
	private: 'Privat',
	public: 'Öffentlich',
	domain: 'Domäne',
	unknown: 'unbekannt'
};

/** "Ethernet · Netzwerk Öffentlich" or, for a name, "Name in der FRITZ!Box · Ethernet". */
export function candidateText(entry: LanCandidate): string {
	const network = `Netzwerk ${CATEGORY_LABELS[entry.category]}`;
	const adapter = entry.adapter === '' ? '' : `${entry.adapter} · `;
	if (entry.kind === 'name') {
		const where = entry.address.endsWith('.fritz.box')
			? 'Name in der FRITZ!Box'
			: 'Name im Heimnetz';
		return `${where} · ${adapter}${network}`;
	}
	return `${adapter}${network}`;
}

export const FIREWALL_TEXTS: Readonly<Record<FirewallState, string>> = {
	present: 'Vorhanden: Die Firewall lässt Geräte im Heimnetz zur App durch.',
	missing: 'Fehlt: Die Firewall lässt Geräte im Heimnetz noch nicht durch.',
	mismatch:
		'Passt nicht: Die Regel gilt für einen anderen Port, nicht für private Netzwerke oder ist ausgeschaltet.',
	unknown: 'Nicht lesbar: Windows hat die Regeln der Firewall nicht genannt.'
};

export const LAN_TEXTS = {
	warningTitle: 'Unverschlüsselt im Heimnetz',
	warning:
		'Andere Geräte öffnen die App über HTTP ohne Verschlüsselung. Passwörter und Inhalte gehen unverschlüsselt durchs WLAN; wer im selben Netz mitliest, kann sie sehen. Schalte den Zugriff nur in deinem eigenen, vertrauenswürdigen Heimnetz ein, nie in fremden Netzen (Café, Hotel). Verschlüsselt (HTTPS) folgt mit dem Umzug auf den Raspberry Pi.',
	urlLabel: 'Adresse für andere Geräte',
	urlHint:
		'Im Browser des Handys oder eines zweiten Rechners im selben Heimnetz öffnen und mit dem eigenen Konto anmelden. Die Anmeldung gilt je Adresse und Gerät.',
	firewallConfirmAdd: 'Firewall-Regel anlegen?',
	firewallConfirmRemove: 'Firewall-Regel entfernen?',
	firewallRule: (port: number) =>
		`Die Regel „${LAN_RULE_NAME}“ lässt nur pocketbase.exe dieses Ordners, nur TCP-Port ${port} und nur in privaten Netzwerken durch.`,
	uac: 'Windows fragt gleich auf diesem Rechner nach Administratorrechten (Benutzerkontensteuerung). Bitte dort bestätigen; die Seite wartet so lange.',
	profileTitle: (address: string, label: string) => `Netzwerk von ${address} ist „${label}“`,
	profile:
		'Die Firewall-Regel gilt nur in privaten Netzwerken. Stufe nur dein eigenes Heimnetz als „Privat“ ein: Einstellungen → Netzwerk und Internet → Status → „Eigenschaften“ bei der Verbindung (WLAN: Netzwerk und Internet → WLAN → das Netzwerk) → Netzwerkprofil „Privat“.',
	missingTitle: (address: string) => `${address} gehört gerade zu keinem Netzwerkadapter`,
	missing:
		'Der Router hat diesem Rechner wohl eine andere Adresse gegeben. Reserviere eine feste Adresse in der FRITZ!Box (unten) und wähle dann die aktuelle Adresse.',
	blockedTitle: 'Eine Sperrregel blockiert pocketbase.exe',
	blocked:
		'Sie entsteht meist, wenn bei der Windows-Sicherheitswarnung für pocketbase.exe „Abbrechen“ gewählt wurde, und gilt vor jeder Erlaubnis. Entferne sie unter „Windows Defender Firewall mit erweiterter Sicherheit“ → Eingehende Regeln (Regeln für pocketbase.exe mit „Blockieren“) oder mit doctor im Ordner app.',
	alert:
		'Erscheint beim ersten Start mit Zugriff im Heimnetz die Windows-Sicherheitswarnung für pocketbase.exe, nur „Private Netzwerke“ anhaken.',
	fritzTitle: 'Feste Adresse in der FRITZ!Box reservieren',
	fritzSteps: [
		'fritz.box im Browser öffnen und anmelden.',
		'Heimnetz → Netzwerk → Netzwerkverbindungen: beim Eintrag dieses Rechners auf „Bearbeiten“ (Stift).',
		'„Diesem Netzwerkgerät immer die gleiche IPv4-Adresse zuweisen“ anhaken und mit OK speichern.'
	],
	fritzHint:
		'So bleibt die Adresse für andere Geräte gleich. Der Name in der FRITZ!Box (…fritz.box) funktioniert auch nach einem Wechsel der Adresse.',
	restartTitle: 'Neustart nötig',
	restart:
		'Der Zugriff im Heimnetz ändert sich erst nach einem Neustart der App. Auf der Seite „System“ startest du sie mit „Jetzt neu starten“ neu, oder mit neu-starten.bat im Ordner app.'
} as const;

/** The flag after a saved setting. */
export function savedTitle(enabled: boolean): string {
	return enabled ? 'Zugriff im Heimnetz eingeschaltet' : 'Zugriff im Heimnetz ausgeschaltet';
}

/** The flag after a change of the rule. */
export function firewallDoneTitle(action: FirewallAction): string {
	return action === 'add' ? 'Firewall-Regel angelegt' : 'Firewall-Regel entfernt';
}

/** Text of a 400 of the routes in the words of the page. */
export const LAN_INVALID_TEXTS: Readonly<Record<string, string>> = {
	format: 'Schalter oder Adressen fehlen.',
	invalid: 'Mindestens eine Adresse gehört nicht ins Heimnetz.',
	'too-many': `Höchstens ${LAN_MAX} Adressen.`,
	required: 'Bitte mindestens eine Adresse wählen.',
	action: 'Diese Aktion gibt es nicht.'
};

export function lanInvalidText(problem: string): string {
	const text = Object.hasOwn(LAN_INVALID_TEXTS, problem) ? LAN_INVALID_TEXTS[problem] : undefined;
	return text ?? 'Der Server hat die Eingabe abgelehnt.';
}
