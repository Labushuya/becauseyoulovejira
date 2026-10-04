// Page "Einstellungen → Sicherheit" (ADR-0055 §8, SH-2): the answer of GET /api/byl/security read
// strictly, the rule of the further hosts (the same as normalizeExtraHost of app/pb_hooks/lib/
// security-rules.js, parity test) and the words of the page. Pure; the server decides
// (app/pb_hooks/lib/security-service.js), the SPA only words it.

import { lanUrl, parseLanOverview, type LanOverview } from './lan';
import { formatPointInTime, type SystemDenial } from './system';

export type SecurityLevel = 'normal' | 'strict' | 'custom' | 'off';
/** The levels the page offers; "custom" and "off" come only from the admin UI. */
export const LEVEL_CHOICES = ['normal', 'strict'] as const;
export type LevelChoice = (typeof LEVEL_CHOICES)[number];

const AREAS = ['app', 'admin'] as const;
export type LoginArea = (typeof AREAS)[number];
const SOURCES = ['app', 'web', 'program'] as const;
export type LoginSource = (typeof SOURCES)[number];

/** Failed sign-ins of the same account, source and address within the last 30 days. */
export interface LoginGroup {
	area: LoginArea;
	identity: string;
	known: boolean;
	source: LoginSource;
	host: string;
	count: number;
	/** PocketBase times ("2026-10-03 12:00:00.000Z"). */
	first: string;
	last: string;
}

export interface SecurityOverview {
	level: SecurityLevel;
	cors: { restricted: boolean };
	hosts: {
		/** The own addresses with the port, e.g. "127.0.0.1:8090". */
		own: readonly string[];
		/** The further hosts the server started with. */
		active: readonly string[];
		/** The further hosts of byl-config.json (they apply after a restart). */
		configured: readonly string[];
		/** The control script of the own instance can change them (Windows, folder app). */
		editable: boolean;
		max: number;
	};
	/** The access in the home network as the server runs now (plan heimnetz). */
	lan: LanOverview;
	admin: { ips: readonly string[]; loopbackOnly: boolean };
	session: { days: number | null; seconds: number; choices: readonly number[]; standard: number };
	backup: {
		available: boolean;
		target: boolean;
		/** null: no target, or it is not reachable right now. */
		reachable: boolean | null;
		sealed: number;
		newest: string | null;
	};
	secrets: readonly { name: string; set: boolean }[];
	keys: { count: number; lastUsedAt: string | null };
	extension: { built: boolean; version: string };
	/** null before the restart after the update (no protocol yet). */
	logins: { days: number; total: number; lastDay: number; groups: readonly LoginGroup[] } | null;
}

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function strings(value: unknown): string[] | null {
	if (!Array.isArray(value)) return null;
	return value.every((entry) => typeof entry === 'string') ? (value as string[]) : null;
}

function oneOf<T extends string>(list: readonly T[], value: unknown): value is T {
	return typeof value === 'string' && (list as readonly string[]).includes(value);
}

function loginGroup(value: unknown): LoginGroup | null {
	if (!isRecord(value)) return null;
	const { area, identity, known, source, host, count, first, last } = value;
	if (!oneOf(AREAS, area) || !oneOf(SOURCES, source)) return null;
	if (typeof identity !== 'string' || typeof known !== 'boolean' || typeof host !== 'string') {
		return null;
	}
	if (!isCount(count) || typeof first !== 'string' || typeof last !== 'string') return null;
	return { area, identity, known, source, host, count, first, last };
}

function logins(value: unknown): SecurityOverview['logins'] | undefined {
	if (value === null) return null;
	if (!isRecord(value) || !Array.isArray(value.groups)) return undefined;
	const { days, total, lastDay } = value;
	if (!isCount(days) || !isCount(total) || !isCount(lastDay)) return undefined;
	const groups = value.groups.map(loginGroup);
	if (!groups.every((group) => group !== null)) return undefined;
	return { days, total, lastDay, groups: groups as LoginGroup[] };
}

/** The overview of the server, or null for anything else (the page then says it failed). */
export function parseSecurity(value: unknown): SecurityOverview | null {
	if (!isRecord(value) || !oneOf(['normal', 'strict', 'custom', 'off'] as const, value.level)) {
		return null;
	}
	const { cors, hosts, admin, session, backup, keys, extension } = value;
	if (!isRecord(cors) || !isRecord(hosts) || !isRecord(admin) || !isRecord(session)) return null;
	if (!isRecord(backup) || !isRecord(keys) || !isRecord(extension)) return null;
	const own = strings(hosts.own);
	const active = strings(hosts.active);
	const configured = strings(hosts.configured);
	const ips = strings(admin.ips);
	const choices =
		Array.isArray(session.choices) && session.choices.every(isCount) ? session.choices : null;
	const secrets = Array.isArray(value.secrets)
		? value.secrets.filter(
				(entry): entry is { name: string; set: boolean } =>
					isRecord(entry) && typeof entry.name === 'string' && typeof entry.set === 'boolean'
			)
		: null;
	const protocol = logins(value.logins);
	if (own === null || active === null || configured === null || ips === null || choices === null) {
		return null;
	}
	if (secrets === null || protocol === undefined || !isCount(hosts.max)) return null;
	if (!isCount(session.seconds) || !isCount(session.standard)) return null;
	if (!isCount(keys.count) || !isCount(backup.sealed)) return null;
	return {
		level: value.level,
		cors: { restricted: cors.restricted === true },
		hosts: { own, active, configured, editable: hosts.editable === true, max: hosts.max },
		lan: parseLanOverview(value.lan),
		admin: { ips, loopbackOnly: admin.loopbackOnly === true },
		session: {
			days: isCount(session.days) ? session.days : null,
			seconds: session.seconds,
			choices,
			standard: session.standard
		},
		backup: {
			available: backup.available === true,
			target: backup.target === true,
			reachable: typeof backup.reachable === 'boolean' ? backup.reachable : null,
			sealed: backup.sealed,
			newest: typeof backup.newest === 'string' ? backup.newest : null
		},
		secrets: secrets.map(({ name, set }) => ({ name, set })),
		keys: {
			count: keys.count,
			lastUsedAt: typeof keys.lastUsedAt === 'string' ? keys.lastUsedAt : null
		},
		extension: {
			built: extension.built === true,
			version: typeof extension.version === 'string' ? extension.version : ''
		},
		logins: protocol
	};
}

/** The notice of GET /api/byl/security/notice: attention, count of the last 24 hours, newest time. */
export interface SecurityNotice {
	attention: boolean;
	count: number;
	last: string | null;
}

export function parseNotice(value: unknown): SecurityNotice | null {
	if (!isRecord(value) || typeof value.attention !== 'boolean') return null;
	if (!isCount(value.count)) return null;
	return {
		attention: value.attention,
		count: value.count,
		last: typeof value.last === 'string' ? value.last : null
	};
}

// --- Further hosts ------------------------------------------------------------------------------

/** At most this many further hosts (EXTRA_HOSTS_MAX of security-rules.js). */
export const EXTRA_HOSTS_MAX = 10;
const EXTRA_HOST =
	/^(?=.{1,253}(?::[0-9]{1,5})?$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?(?::([0-9]{1,5}))?$/;

/** `value` trimmed and in lower case if it is a valid further host, otherwise ''. */
export function normalizeExtraHost(value: unknown): string {
	const host = typeof value === 'string' ? value.trim().toLowerCase() : '';
	const match = EXTRA_HOST.exec(host);
	if (match === null) return '';
	if (match[1] !== undefined) {
		const port = Number.parseInt(match[1], 10);
		if (port < 1 || port > 65535) return '';
	}
	return host;
}

/** Why an entered further host is refused, or '' when it can be added to `hosts`. */
export function extraHostProblem(value: string, hosts: readonly string[]): string {
	if (value.trim() === '') return 'Bitte eine Adresse eingeben.';
	const host = normalizeExtraHost(value);
	if (host === '') {
		return 'Nur ein Name mit Punkt, etwa rechner.tailnet.ts.net, optional mit Port (pi.example.org:8443); ohne http:// und ohne IP-Adresse.';
	}
	if (hosts.includes(host)) return 'Diese Adresse steht schon in der Liste.';
	if (hosts.length >= EXTRA_HOSTS_MAX) return `Höchstens ${EXTRA_HOSTS_MAX} zusätzliche Adressen.`;
	return '';
}

/** Whether two lists of hosts hold the same names (order does not matter). */
export function sameHosts(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((host) => b.includes(host));
}

// --- Words of the page --------------------------------------------------------------------------

export const LEVEL_LABELS: Readonly<Record<LevelChoice, { label: string; hint: string }>> = {
	normal: {
		label: 'Normal',
		hint: 'Bis zu 10 Anmeldeversuche je Minute; nach Tippfehlern höchstens eine Minute warten. Anfragen ohne Anmeldung: 300 je 10 Sekunden.'
	},
	strict: {
		label: 'Streng',
		hint: 'Bis zu 5 Anmeldeversuche je 5 Minuten; nach Tippfehlern bis zu 5 Minuten warten. Anfragen ohne Anmeldung: 100 je 10 Sekunden.'
	}
};

/** "1 Tag", "5 Tage (Standard)". */
export function sessionLabel(days: number, standard: number): string {
	const text = days === 1 ? '1 Tag' : `${days} Tage`;
	return days === standard ? `${text} (Standard)` : text;
}

/** A duration that is no choice of the page, e.g. set in the admin UI. */
export function customSessionLabel(seconds: number): string {
	const hours = Math.round(seconds / 3600);
	if (hours >= 48) return `Eigene Einstellung: ${Math.round(hours / 24)} Tage`;
	return `Eigene Einstellung: ${hours === 1 ? '1 Stunde' : `${hours} Stunden`}`;
}

export type StatusTone = 'brand' | 'neutral' | 'muted' | 'danger';
export type StatusIcon = 'success' | 'warning' | 'info' | 'error';

/** One line of the overview: name, state as lozenge, one sentence and what it means. */
export interface StatusLine {
	id: string;
	title: string;
	state: string;
	tone: StatusTone;
	icon: StatusIcon;
	text: string;
	meaning: string;
}

const ON = { tone: 'brand', icon: 'success' } as const;
const WARN = { tone: 'neutral', icon: 'warning' } as const;
const NONE = { tone: 'muted', icon: 'info' } as const;

function count(n: number, one: string, many: string): string {
	return n === 1 ? `1 ${one}` : `${n} ${many}`;
}

function levelLine(overview: SecurityOverview): StatusLine {
	const base = {
		id: 'rate',
		title: 'Schutz vor Rateversuchen',
		meaning:
			'Wer ein Passwort erraten will, braucht viele Versuche. Die App lässt nur wenige Anmeldungen je Minute zu, für App-Konto und Admin-Konto getrennt, und begrenzt alles, was ohne Anmeldung kommt. Was du angemeldet tust, zählt nie. Alle Programme auf diesem Rechner teilen sich eine Zählung.'
	};
	switch (overview.level) {
		case 'normal':
		case 'strict':
			return {
				...base,
				...ON,
				state: `Aktiv (${LEVEL_LABELS[overview.level].label})`,
				text: LEVEL_LABELS[overview.level].hint
			};
		case 'custom':
			return {
				...base,
				...WARN,
				state: 'Eigene Einstellung',
				text: 'In der Verwaltung sind eigene Regeln gesetzt. Eine Stufe unten ersetzt sie.'
			};
		default:
			return {
				...base,
				...WARN,
				state: 'Aus',
				text: 'Der Schutz ist in der Verwaltung ausgeschaltet. Eine Stufe unten schaltet ihn wieder ein.'
			};
	}
}

function hostList(hosts: readonly string[]): string {
	return hosts.join(', ');
}

/** The lines of the overview, in the order of the page. */
export function statusLines(overview: SecurityOverview): StatusLine[] {
	const { hosts, admin, backup, secrets, keys, extension } = overview;
	const lines: StatusLine[] = [levelLine(overview)];
	lines.push({
		id: 'cors',
		title: 'Nur eigene Oberfläche (CORS)',
		...(overview.cors.restricted ? ON : WARN),
		state: overview.cors.restricted ? 'Aktiv' : 'Neustart nötig',
		text: overview.cors.restricted
			? 'Antworten der App darf nur die App selbst lesen.'
			: 'Die App wurde ohne diese Einschränkung gestartet; neu-starten.bat im Ordner app schaltet sie ein.',
		meaning:
			'Jede Webseite in deinem Browser kann Anfragen an diesen Rechner schicken. Ihre Antworten lesen darf aber nur die App unter ihrer eigenen Adresse. Die Browser-Erweiterung, Skripte und der Mail-Helfer brauchen das nicht.'
	});
	const named = [...hosts.active, ...(overview.lan.active ? overview.lan.hosts : [])];
	const active = named.length === 0 ? '' : ` und ${hostList(named)}`;
	lines.push({
		id: 'host',
		title: 'Host-Schutz',
		...ON,
		state: 'Aktiv',
		text: `Die App antwortet nur unter ${hostList(hosts.own)}${active}.`,
		meaning:
			'Eine fremde Seite kann sich einen Namen besorgen, der kurz auf diesen Rechner zeigt (DNS-Rebinding). Die App antwortet deshalb nur unter ihren eigenen Adressen; jede andere Anfrage lehnt sie ab, bevor sie etwas liest.'
	});
	lines.push(lanLine(overview.lan));
	lines.push({
		id: 'admin',
		title: 'Admin-Oberfläche',
		...(admin.loopbackOnly ? ON : WARN),
		state: admin.loopbackOnly
			? 'Nur dieser Rechner'
			: admin.ips.length === 0
				? 'Ohne Beschränkung'
				: 'Eigene Liste',
		text: admin.loopbackOnly
			? 'Die Verwaltung (/_/) nimmt Admin-Anfragen nur von diesem Rechner an.'
			: admin.ips.length === 0
				? 'Admin-Anfragen werden von jeder Adresse angenommen, die die App erreicht.'
				: `Admin-Anfragen nur von: ${admin.ips.join(', ')}.`,
		meaning:
			'Mit dem Admin-Konto lässt sich in der Verwaltung alles ändern. Es zählt seine Anmeldeversuche getrennt und gilt nur von den genannten Adressen.'
	});
	lines.push(backupLine(backup));
	lines.push({
		id: 'secrets',
		title: 'Zugangsdaten',
		...(secrets.length > 0 ? ON : NONE),
		state: secrets.length > 0 ? 'In Umgebungsvariablen' : 'Keine',
		text:
			secrets.length > 0
				? `${count(secrets.length, 'Variable', 'Variablen')} im Windows-Konto: ${secrets.map((entry) => entry.name).join(', ')}${secrets.some((entry) => !entry.set) ? ' (nicht alle gesetzt)' : ''}.`
				: 'Keine Verbindung braucht gerade Zugangsdaten.',
		meaning:
			'Passwörter und Tokens der Kanäle stehen nur als BYL_…-Variablen in deinem Windows-Konto, nie in der Datenbank und nie in den Sicherungen im Ordner app. Die App kennt nur ihre Namen; mitgesichert werden sie nur verschlüsselt, wenn du es unter „Sicherung“ einschaltest.'
	});
	lines.push({
		id: 'keys',
		title: 'Zugangsschlüssel des eigenen Eingangs',
		...(keys.count > 0 ? ON : NONE),
		state: keys.count > 0 ? count(keys.count, 'Schlüssel', 'Schlüssel') : 'Keine',
		text:
			keys.count === 0
				? 'Kein Programm darf Einträge in deinen Eingang legen.'
				: keys.lastUsedAt === null
					? 'Noch nie benutzt.'
					: `Zuletzt benutzt ${formatPointInTime(pocketBaseIso(keys.lastUsedAt))}.`,
		meaning:
			'Ein Zugangsschlüssel erlaubt einem Programm auf diesem Rechner (etwa der Browser-Erweiterung oder einem Skript), Einträge in deinen Eingang zu legen, sonst nichts. Webseiten können ihn nicht benutzen. Nicht mehr gebrauchte Schlüssel widerrufst du unter „Kanäle“.'
	});
	lines.push({
		id: 'extension',
		title: 'Browser-Erweiterung',
		...(extension.built ? ON : NONE),
		state: extension.built ? 'Gebaut' : 'Nicht gebaut',
		text: extension.built
			? `Version ${extension.version}; sie spricht nur mit dieser App auf 127.0.0.1 bzw. localhost.`
			: 'Die Erweiterung für WhatsApp Web liegt nicht im Ordner app.',
		meaning:
			'Die Erweiterung liest nur im offenen Tab von WhatsApp Web, sendet nie etwas in WhatsApp und legt Nachrichten nur mit einem Zugangsschlüssel in deinen Eingang. Nur sie bekommt dafür eine Ausnahme von der Regel „nur eigene Oberfläche“.'
	});
	return lines;
}

function lanLine(lan: LanOverview): StatusLine {
	const base = {
		id: 'lan',
		title: 'Zugriff im Heimnetz',
		meaning:
			'Ausgeschaltet ist die App nur auf diesem Rechner erreichbar. Eingeschaltet öffnen andere Geräte im Heimnetz (etwa ein Handy im WLAN) sie unter einer Adresse dieses Rechners, unverschlüsselt über HTTP und mit eigener Anmeldung. Die Seiten System, Sicherung, Speicher und Sicherheit und die Verwaltung bleiben auch dann nur auf diesem Rechner.'
	};
	if (lan.active && lan.hosts.length > 0) {
		return {
			...base,
			...WARN,
			state: 'An (unverschlüsselt)',
			text: `Andere Geräte erreichen die App unter ${lan.hosts.map(lanUrl).join(', ')}.`
		};
	}
	return { ...base, ...ON, state: 'Aus', text: 'Die App ist nur auf diesem Rechner erreichbar.' };
}

function backupLine(backup: SecurityOverview['backup']): StatusLine {
	const base = {
		id: 'backup',
		title: 'Sicherungen verschlüsselt',
		meaning:
			'Die tägliche Sicherung im Ordner app ist nicht verschlüsselt. Ins Zielverzeichnis (etwa ein USB-Laufwerk) kommt sie nur verschlüsselt mit deiner Passphrase, damit ein verlorenes Laufwerk nichts verrät.'
	};
	if (!backup.available) {
		return {
			...base,
			...NONE,
			state: 'Nicht verfügbar',
			text: 'Die Sicherung gibt es nur, wenn die App unter Windows läuft.'
		};
	}
	if (!backup.target) {
		return {
			...base,
			...WARN,
			state: 'Kein Zielverzeichnis',
			text: 'Sicherungen liegen nur unverschlüsselt im Ordner app.'
		};
	}
	if (backup.reachable === false) {
		return {
			...base,
			...WARN,
			state: 'Ziel nicht erreichbar',
			text: 'Das Zielverzeichnis ist gerade nicht erreichbar.'
		};
	}
	if (backup.sealed === 0) {
		return {
			...base,
			...WARN,
			state: 'Noch keine',
			text: 'Im Zielverzeichnis liegt noch keine verschlüsselte Sicherung.'
		};
	}
	return {
		...base,
		...ON,
		state: 'Verschlüsselt',
		text: `${count(backup.sealed, 'verschlüsselte Sicherung', 'verschlüsselte Sicherungen')} im Zielverzeichnis, die neueste ${formatPointInTime(backup.newest)}.`
	};
}

/** A PocketBase time ("2026-10-03 12:00:00.000Z") as ISO for formatPointInTime. */
export function pocketBaseIso(value: string): string {
	return value.replace(' ', 'T');
}

export const AREA_LABELS: Readonly<Record<LoginArea, string>> = {
	app: 'App-Konto',
	admin: 'Admin-Konto (Verwaltung)'
};

export const SOURCE_LABELS: Readonly<Record<LoginSource, string>> = {
	app: 'aus der App',
	web: 'von einer anderen Webseite',
	program: 'von einem Programm'
};

/** One line of the protocol: "anna@example.com · App-Konto · aus der App · 3 Versuche · zuletzt …". */
export function loginText(group: LoginGroup): string {
	const account = group.identity === '' ? '(leer)' : group.identity;
	const known = group.known ? '' : ' (kein solches Konto)';
	const attempts = count(group.count, 'Versuch', 'Versuche');
	const host = group.host === '' ? '' : ` über ${group.host}`;
	return `${account}${known} · ${AREA_LABELS[group.area]} · ${SOURCE_LABELS[group.source]}${host} · ${attempts} · zuletzt ${formatPointInTime(pocketBaseIso(group.last))}`;
}

export const NOTICE_TEXTS = {
	action: 'Ansehen',
	/** "12 fehlgeschlagene Anmeldeversuche in den letzten 24 Stunden." */
	title: (n: number) => `${n} fehlgeschlagene Anmeldeversuche in den letzten 24 Stunden.`
} as const;

/** What the page says for a refusal of its routes. */
export function denialText(reason: SystemDenial): { title: string; text: string } {
	switch (reason) {
		case 'loopback':
			return {
				title: 'Nur auf dem Rechner der App',
				text: 'Die Sicherheit zeigt die App nur im Browser auf dem Rechner, auf dem sie läuft, unter ihrer eigenen Adresse (etwa http://127.0.0.1:8090/), nicht von einem anderen Gerät im Heimnetz und nicht über einen Proxy.'
			};
		case 'origin':
			return {
				title: 'Nur unter der Adresse der App',
				text: 'Öffne die App unter ihrer eigenen Adresse auf diesem Rechner, etwa http://127.0.0.1:8090/, und versuche es dort erneut.'
			};
		case 'owner':
		case 'forbidden':
			return {
				title: 'Nur für das erste Konto',
				text: 'Die Sicherheit der App sieht und ändert nur das Konto, das zuerst angelegt wurde.'
			};
		case 'rate':
			return {
				title: 'Gerade zu viele Anfragen',
				text: 'Bitte einen Moment warten und dann erneut versuchen.'
			};
		case 'platform':
		case 'unavailable':
			return {
				title: 'Hier nicht einstellbar',
				text: 'Zusätzliche Adressen und den Zugriff im Heimnetz stellt nur die App unter Windows aus ihrem Ordner app ein (Steuerskript).'
			};
		case 'busy':
			return {
				title: 'Es läuft schon eine Aktion',
				text: 'Bitte warten, bis sie fertig ist, und dann erneut versuchen.'
			};
		default:
			return {
				title: 'Die Sicherheit ließ sich nicht laden',
				text: 'Der Server hat nicht wie erwartet geantwortet. Bitte die Seite neu laden.'
			};
	}
}

/** Text of a 400 of the routes in the words of the page. */
export const INVALID_TEXTS: Readonly<Record<string, string>> = {
	empty: 'Es gab nichts zu speichern.',
	level: 'Diese Stufe gibt es nicht.',
	days: 'Diese Dauer gibt es nicht.',
	format: 'Die Adressen fehlen.',
	invalid: 'Mindestens eine Adresse ist kein gültiger Name.',
	'too-many': `Höchstens ${EXTRA_HOSTS_MAX} zusätzliche Adressen.`
};

/** The text of a 400, or a general one for a problem the page does not know. */
export function invalidText(problem: string): string {
	const text = Object.hasOwn(INVALID_TEXTS, problem) ? INVALID_TEXTS[problem] : undefined;
	return text ?? 'Der Server hat die Eingabe abgelehnt.';
}
