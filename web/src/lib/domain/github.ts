// GitHub channel in the web app (ADR-0050, plan beobachtete-quellen GH-2). Pure: the settings of a
// connection (repositories with watched paths, events and target project, interval, since the
// addendum of 2026-10-02 "Alle meine Repositorys" and its exclusions), the checks of the form, the
// details of the card from GET /api/byl/connections/{id}/github, the list of the repositories of
// the token (GET …/github/repos) and the answer of "Verbindung prüfen". The names, patterns, limits,
// defaults and texts mirror app/pb_hooks/lib/github-rules.js (tests/unit/web-github.test.mjs
// compares both).

import { formatBerlinDateTime } from './format';
import { normalizeSearch, searchWords } from './ticket-picker';

/** Watched paths a new repository starts with (ADR-0050 §2). */
export const GITHUB_DEFAULT_PATHS: readonly string[] = Object.freeze([
	'ROADMAP*',
	'CHANGELOG*',
	'README*',
	'docs/**/roadmap*'
]);

/** Offered, not set: every Markdown file below docs. */
export const GITHUB_DOCS_PATH = 'docs/**/*.md';

export const GITHUB_EVENTS = ['files', 'pulls', 'releases'] as const;
export type GitHubEvent = (typeof GITHUB_EVENTS)[number];

export const GITHUB_EVENT_LABELS: Readonly<Record<GitHubEvent, string>> = Object.freeze({
	files: 'Dateiänderungen auf dem Standard-Branch',
	pulls: 'Pull Requests (geöffnet, gemergt, geschlossen)',
	releases: 'Releases'
});

/** Short names of the events for the details of the card. */
export const GITHUB_EVENT_SHORT: Readonly<Record<GitHubEvent, string>> = Object.freeze({
	files: 'Dateien',
	pulls: 'Pull Requests',
	releases: 'Releases'
});

export const GITHUB_LIMITS = Object.freeze({
	repos: 20,
	paths: 20,
	pathLength: 200,
	intervalDefault: 15,
	intervalMin: 5,
	intervalMax: 60,
	/** "Alle meine Repositorys": at most this many come in automatically, this many excluded. */
	autoRepos: 50,
	excludes: 100
});

/** Intervals the card offers (minutes); the server takes every whole number from 5 to 60. */
export const GITHUB_INTERVALS: readonly number[] = Object.freeze([5, 10, 15, 30, 60]);

/** Suggested variable of the token (ADR-0018, addendum ADR-0050). */
export const GITHUB_SECRET_NAME = 'BYL_GITHUB_TOKEN';

/** Texts of the codes of the hooks (MESSAGES of github-rules.js), the same words in the interface. */
export const GITHUB_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
	validation_github_settings: 'Unbekannte Einstellung des GitHub-Kanals.',
	validation_github_interval: 'Abruf alle 5 bis 60 Minuten.',
	validation_github_repos_max: 'Höchstens 20 Repositorys je Verbindung.',
	validation_github_repo: 'Repository als „Besitzer/Name“, etwa „octo-org/roadmap“.',
	validation_github_repo_duplicate: 'Dieses Repository ist schon eingetragen.',
	validation_github_paths:
		'Pfade als Liste von höchstens 20 Mustern, je bis 200 Zeichen, etwa „CHANGELOG*“ oder „docs/**/*.md“; ohne „/“ am Anfang, ohne „..“, ohne [ ] { } !.',
	validation_github_events: 'Ereignisse nur „files“, „pulls“ und „releases“, je an oder aus.',
	validation_github_target: 'Zielprojekt als ID eines Projekts oder leer.',
	validation_github_auto: '„Alle meine Repositorys beobachten“ ist an oder aus.',
	validation_github_exclude:
		'Ausgeschlossene Repositorys als Liste von höchstens 100 Namen „Besitzer/Name“, jeder einmal.'
});

/** The hint of a run with "Alle meine Repositorys" but without a token (AUTO_NO_TOKEN of the hook). */
export const AUTO_NO_TOKEN =
	'„Alle meine Repositorys“ braucht ein Token: Ohne Token nennt GitHub keine Liste deiner Repositorys. Die eingetragenen Repositorys ruft die App weiter ab.';

/** Why a repository left "Alle meine Repositorys" (AUTO_REASONS of the hook). */
export const AUTO_REASONS: Readonly<Record<GitHubAutoReason, string>> = Object.freeze({
	archived: 'archiviert',
	fork: 'Fork',
	other: 'nicht mehr deins',
	gone: 'nicht mehr da',
	excluded: 'ausgeschlossen',
	limit: 'über der Grenze von 50'
});

export type GitHubAutoReason = 'archived' | 'fork' | 'other' | 'gone' | 'excluded' | 'limit';

const OWNER = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const NAME = /^[A-Za-z0-9._-]{1,100}$/;
const RECORD_ID = /^[a-z0-9]{15}$/;

export type GitHubEvents = Readonly<Record<GitHubEvent, boolean>>;

export interface GitHubRepoSettings {
	/** "owner/name" as entered. */
	repo: string;
	/** Watched paths (globs). */
	paths: readonly string[];
	events: GitHubEvents;
	/** Target project of the entries of this repository, null for the one of the connection. */
	target: string | null;
}

export interface GitHubSettings {
	/** Minutes between two runs of the cron. */
	interval: number;
	/** The entered repositories, each with its own settings. */
	repos: readonly GitHubRepoSettings[];
	/** "Alle meine Repositorys beobachten" (addendum of 2026-10-02), off by default. */
	auto: boolean;
	/** Repositories "Alle meine Repositorys" leaves out ("Besitzer/Name"). */
	exclude: readonly string[];
}

export const EMPTY_GITHUB_SETTINGS: GitHubSettings = Object.freeze({
	interval: GITHUB_LIMITS.intervalDefault,
	repos: [],
	auto: false,
	exclude: []
});

/** Whether `value` is "owner/name" of a repository (no address, no ".git"). */
export function isRepoName(value: unknown): value is string {
	if (typeof value !== 'string') return false;
	const parts = value.split('/');
	const [owner, name] = parts;
	return (
		parts.length === 2 &&
		owner !== undefined &&
		name !== undefined &&
		OWNER.test(owner) &&
		NAME.test(name) &&
		name !== '.' &&
		name !== '..' &&
		!/\.git$/i.test(name)
	);
}

/**
 * "owner/name" from what a user types or pastes: the name itself, or an address of the repository
 * on github.com (also without scheme, with ".git", a trailing "/" or a deeper page). '' for
 * anything else.
 */
export function parseRepo(input: string): string {
	const value = input.trim();
	const match =
		/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s?#]+)\/([^/\s?#]+)(?:[/?#].*)?$/i.exec(value);
	const candidate = (match ? `${match[1]}/${match[2]}` : value).replace(/\.git$/i, '');
	return isRepoName(candidate) ? candidate : '';
}

/** Key of a repository: "owner/name" in lower case (GitHub ignores case). */
export function repoKey(name: string): string {
	return name.toLowerCase();
}

/** Whether a watched pattern is valid (see PATH_MESSAGE). */
export function isPattern(value: unknown): value is string {
	if (typeof value !== 'string' || value.length === 0 || value.length > GITHUB_LIMITS.pathLength) {
		return false;
	}
	if (
		value.trim() !== value ||
		// eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
		/[\u0000-\u001f\u007f\\[\]{}!]/.test(value) ||
		value.startsWith('/')
	)
		return false;
	return value
		.split('/')
		.every(
			(segment) =>
				segment !== '' &&
				segment !== '.' &&
				segment !== '..' &&
				(!segment.includes('**') || segment === '**')
		);
}

export const REPO_MESSAGE =
	'Bitte ein Repository als „Besitzer/Name“ oder seine Adresse auf github.com angeben, etwa „octo-org/roadmap“.';
export const REPO_DUPLICATE_MESSAGE = 'Dieses Repository ist schon eingetragen.';
export const REPOS_MAX_MESSAGE = `Höchstens ${GITHUB_LIMITS.repos} Repositorys je Verbindung.`;
export const PATH_MESSAGE =
	'Ein Muster beginnt ohne „/“, hat kein „..“ und keine Zeichen [ ] { } !, höchstens 200 Zeichen; „**“ steht nur als ganzer Ordner.';
export const PATHS_MAX_MESSAGE = `Höchstens ${GITHUB_LIMITS.paths} Muster je Repository.`;
export const PATHS_DUPLICATE_MESSAGE = 'Dieses Muster steht zweimal in der Liste.';
export const PATHS_EMPTY_MESSAGE =
	'Bitte mindestens ein Muster angeben oder „Dateiänderungen“ ausschalten.';
export const EVENTS_MESSAGE = 'Bitte mindestens ein Ereignis wählen.';

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validPaths(value: unknown): string[] | null {
	if (!Array.isArray(value) || value.length > GITHUB_LIMITS.paths) return null;
	const seen = new Set<string>();
	for (const path of value) {
		if (!isPattern(path) || seen.has(path.toLowerCase())) return null;
		seen.add(path.toLowerCase());
	}
	return value as string[];
}

/**
 * The settings of a connection as the server reads them (github-rules.settingsOf): defaults for
 * missing values, invalid repositories left out.
 */
export function githubSettingsOf(settings: unknown): GitHubSettings {
	const value = isPlainObject(settings) ? settings : {};
	const interval = value.interval;
	const repos: GitHubRepoSettings[] = [];
	const seen = new Set<string>();
	const list = Array.isArray(value.repos) ? value.repos : [];
	for (const entry of list) {
		if (repos.length >= GITHUB_LIMITS.repos) break;
		if (!isPlainObject(entry) || !isRepoName(entry.repo) || seen.has(repoKey(entry.repo))) continue;
		seen.add(repoKey(entry.repo));
		const events = isPlainObject(entry.events) ? entry.events : {};
		repos.push({
			repo: entry.repo,
			paths: validPaths(entry.paths) ?? [...GITHUB_DEFAULT_PATHS],
			events: {
				files: events.files !== false,
				pulls: events.pulls !== false,
				releases: events.releases !== false
			},
			target: typeof entry.target === 'string' && RECORD_ID.test(entry.target) ? entry.target : null
		});
	}
	const exclude: string[] = [];
	const excluded = new Set<string>();
	for (const name of Array.isArray(value.exclude) ? value.exclude : []) {
		if (exclude.length >= GITHUB_LIMITS.excludes) break;
		if (!isRepoName(name) || excluded.has(repoKey(name))) continue;
		excluded.add(repoKey(name));
		exclude.push(name);
	}
	return {
		interval:
			typeof interval === 'number' &&
			Number.isInteger(interval) &&
			interval >= GITHUB_LIMITS.intervalMin &&
			interval <= GITHUB_LIMITS.intervalMax
				? interval
				: GITHUB_LIMITS.intervalDefault,
		repos,
		auto: value.auto === true,
		exclude
	};
}

/**
 * The JSON the server stores in connections.settings. "Alle meine Repositorys" and its exclusions
 * go along only when set, so saving the other settings also works against the hooks of before the
 * addendum (until the next restart of the app), which do not know the keys.
 */
export function githubSettingsValue(settings: GitHubSettings): Record<string, unknown> {
	return {
		interval: settings.interval,
		repos: settings.repos.map((repo) => ({
			repo: repo.repo,
			paths: [...repo.paths],
			events: { ...repo.events },
			target: repo.target ?? ''
		})),
		...(settings.auto ? { auto: true } : {}),
		...(settings.exclude.length > 0 ? { exclude: [...settings.exclude] } : {})
	};
}

/**
 * The settings with `repo` added at the end or, with the same key, in place of the old one. An
 * entered repository is no longer excluded.
 */
export function withRepo(settings: GitHubSettings, repo: GitHubRepoSettings): GitHubSettings {
	const key = repoKey(repo.repo);
	const index = settings.repos.findIndex((entry) => repoKey(entry.repo) === key);
	const repos =
		index === -1
			? [...settings.repos, repo]
			: settings.repos.map((entry, at) => (at === index ? repo : entry));
	return { ...withoutExcluded(settings, key), repos };
}

/** The settings with every one of `repos` added (see withRepo). */
export function withRepos(
	settings: GitHubSettings,
	repos: readonly GitHubRepoSettings[]
): GitHubSettings {
	return repos.reduce((current, repo) => withRepo(current, repo), settings);
}

/** The settings with `name` left out of "Alle meine Repositorys". */
export function withExcluded(settings: GitHubSettings, name: string): GitHubSettings {
	const key = repoKey(name);
	if (settings.exclude.some((entry) => repoKey(entry) === key)) return settings;
	return { ...settings, exclude: [...settings.exclude, name] };
}

/** The settings with the exclusion of the repository `key` taken back. */
export function withoutExcluded(settings: GitHubSettings, key: string): GitHubSettings {
	if (!settings.exclude.some((entry) => repoKey(entry) === key)) return settings;
	return { ...settings, exclude: settings.exclude.filter((entry) => repoKey(entry) !== key) };
}

/** The settings without the repository `key`. */
export function withoutRepo(settings: GitHubSettings, key: string): GitHubSettings {
	return { ...settings, repos: settings.repos.filter((entry) => repoKey(entry.repo) !== key) };
}

/**
 * What the form of a repository holds: the patterns as text, one per line, and the offered pattern
 * for every Markdown file below docs as a switch of its own (ADR-0050 §2: off by default).
 */
export interface GitHubRepoDraft {
	/** Name or address as typed. */
	input: string;
	pathsText: string;
	docs: boolean;
	events: Record<GitHubEvent, boolean>;
	target: string | null;
}

/** A new repository: the paths of the spec, every event on, no own target. */
export function emptyRepoDraft(): GitHubRepoDraft {
	return {
		input: '',
		pathsText: GITHUB_DEFAULT_PATHS.join('\n'),
		docs: false,
		events: { files: true, pulls: true, releases: true },
		target: null
	};
}

function isDocsPath(path: string): boolean {
	return path.toLowerCase() === GITHUB_DOCS_PATH.toLowerCase();
}

/** The form of a repository that is there already. */
export function repoDraftOf(repo: GitHubRepoSettings): GitHubRepoDraft {
	return {
		input: repo.repo,
		pathsText: repo.paths.filter((path) => !isDocsPath(path)).join('\n'),
		docs: repo.paths.some(isDocsPath),
		events: { ...repo.events },
		target: repo.target
	};
}

/** The patterns of the form: one per line, without blank lines, the docs pattern last if chosen. */
export function draftPaths(draft: Pick<GitHubRepoDraft, 'pathsText' | 'docs'>): string[] {
	const lines = draft.pathsText
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line !== '' && !isDocsPath(line));
	return draft.docs ? [...lines, GITHUB_DOCS_PATH] : lines;
}

/** Error of the patterns of the form, naming the first pattern that is wrong; null when fine. */
export function pathsError(
	draft: Pick<GitHubRepoDraft, 'pathsText' | 'docs' | 'events'>
): string | null {
	const paths = draftPaths(draft);
	const invalid = paths.find((path) => !isPattern(path));
	if (invalid !== undefined) return `„${invalid}“: ${PATH_MESSAGE}`;
	const seen = new Set<string>();
	for (const path of paths) {
		if (seen.has(path.toLowerCase())) return `„${path}“: ${PATHS_DUPLICATE_MESSAGE}`;
		seen.add(path.toLowerCase());
	}
	if (paths.length > GITHUB_LIMITS.paths) return PATHS_MAX_MESSAGE;
	if (paths.length === 0 && draft.events.files) return PATHS_EMPTY_MESSAGE;
	return null;
}

export type RepoDraftField = 'repo' | 'paths' | 'events';

/**
 * Errors of the form: the name (and that it is not there yet, except the one being edited, `editing`
 * its key), the number of repositories, the patterns, the events. Empty when the draft is fine.
 */
export function repoDraftErrors(
	draft: GitHubRepoDraft,
	settings: GitHubSettings,
	editing: string | null
): Partial<Record<RepoDraftField, string>> {
	const errors: Partial<Record<RepoDraftField, string>> = {};
	const name = parseRepo(draft.input);
	if (name === '') {
		errors.repo = REPO_MESSAGE;
	} else if (editing === null || repoKey(name) !== editing) {
		if (settings.repos.some((entry) => repoKey(entry.repo) === repoKey(name))) {
			errors.repo = REPO_DUPLICATE_MESSAGE;
		} else if (editing === null && settings.repos.length >= GITHUB_LIMITS.repos) {
			errors.repo = REPOS_MAX_MESSAGE;
		}
	}
	const paths = pathsError(draft);
	if (paths !== null) errors.paths = paths;
	if (!GITHUB_EVENTS.some((event) => draft.events[event])) errors.events = EVENTS_MESSAGE;
	return errors;
}

/** The settings of a repository from a valid draft. */
export function repoFromDraft(draft: GitHubRepoDraft): GitHubRepoSettings {
	return {
		repo: parseRepo(draft.input),
		paths: draftPaths(draft),
		events: { ...draft.events },
		target: draft.target
	};
}

export const CHOOSE_MESSAGE =
	'Bitte ein Repository aus der Liste wählen oder als „Besitzer/Name“ eintragen.';

/** Too many repositories at once for the entered ones of a connection. */
export function addMaxMessage(free: number): string {
	const left = free <= 0 ? 'keins mehr frei' : free === 1 ? 'noch 1 frei' : `noch ${free} frei`;
	return `Höchstens ${GITHUB_LIMITS.repos} eingetragene Repositorys je Verbindung (${left}). Alle eigenen beobachtet „Alle meine Repositorys beobachten“.`;
}

/**
 * Errors of "Repository hinzufügen …" with the list of the token (addendum of 2026-10-02): the
 * repositories chosen from the list (`chosen`, "Besitzer/Name") and a typed one, if any. One of
 * them is needed, a typed one must be a name or address, none may be entered already, and together
 * they stay within the limit of entered repositories. Paths and events as in repoDraftErrors.
 * `listed`: the form shows a list to choose from (the message for nothing names it).
 */
export function addDraftErrors(
	draft: GitHubRepoDraft,
	chosen: readonly string[],
	settings: GitHubSettings,
	listed = false
): Partial<Record<RepoDraftField, string>> {
	const errors: Partial<Record<RepoDraftField, string>> = {};
	const typed = draft.input.trim();
	const name = typed === '' ? '' : parseRepo(typed);
	if (typed === '' && chosen.length === 0) {
		errors.repo = listed ? CHOOSE_MESSAGE : REPO_MESSAGE;
	} else if (typed !== '' && name === '') {
		errors.repo = REPO_MESSAGE;
	} else {
		const keys = [...chosen, ...(name === '' ? [] : [name])].map(repoKey);
		const entered = new Set(settings.repos.map((entry) => repoKey(entry.repo)));
		if (new Set(keys).size !== keys.length || keys.some((key) => entered.has(key))) {
			errors.repo = REPO_DUPLICATE_MESSAGE;
		} else if (settings.repos.length + keys.length > GITHUB_LIMITS.repos) {
			errors.repo = addMaxMessage(GITHUB_LIMITS.repos - settings.repos.length);
		}
	}
	const paths = pathsError(draft);
	if (paths !== null) errors.paths = paths;
	if (!GITHUB_EVENTS.some((event) => draft.events[event])) errors.events = EVENTS_MESSAGE;
	return errors;
}

/** The repositories the form adds: the chosen ones, then the typed one, each with the fields. */
export function reposFromAddDraft(
	draft: GitHubRepoDraft,
	chosen: readonly string[]
): GitHubRepoSettings[] {
	const typed = draft.input.trim() === '' ? [] : [parseRepo(draft.input)];
	return [...chosen, ...typed].map((repo) => ({
		repo,
		paths: draftPaths(draft),
		events: { ...draft.events },
		target: draft.target
	}));
}

// --- The repositories of the token (GET /api/byl/connections/{id}/github/repos) ----------------

/** How a repository of the list stands at the connection. */
export type GitHubChoiceState = 'entered' | 'auto' | 'excluded' | '';

export interface GitHubRepoChoice {
	repo: string;
	key: string;
	private: boolean;
	archived: boolean;
	fork: boolean;
	/** Owned by an organization. */
	org: boolean;
	/** Owned by the account of the token (archived and forks included). */
	own: boolean;
	state: GitHubChoiceState;
}

export interface GitHubRepoList {
	/** `no_token`: GitHub names no list without a token; `limited`/`error` may keep a list of before. */
	status: 'ok' | 'no_token' | 'limited' | 'error';
	message: string;
	/** Account of the token. */
	login: string;
	/** When the server read the list (ISO), null without one. */
	at: string | null;
	/** More than ten pages: the rest is not listed. */
	more: boolean;
	repos: GitHubRepoChoice[];
}

/** The answer of the route, read strictly. */
export function githubRepoListOf(value: unknown): GitHubRepoList {
	const raw = isPlainObject(value) ? value : {};
	const status =
		raw.status === 'ok' ||
		raw.status === 'no_token' ||
		raw.status === 'limited' ||
		raw.status === 'error'
			? raw.status
			: 'error';
	const repos: GitHubRepoChoice[] = [];
	const seen = new Set<string>();
	for (const entry of Array.isArray(raw.repos) ? raw.repos : []) {
		if (!isPlainObject(entry) || !isRepoName(entry.repo) || seen.has(repoKey(entry.repo))) continue;
		seen.add(repoKey(entry.repo));
		const state = entry.state;
		repos.push({
			repo: entry.repo,
			key: repoKey(entry.repo),
			private: entry.private === true,
			archived: entry.archived === true,
			fork: entry.fork === true,
			org: entry.org === true,
			own: entry.own === true,
			state: state === 'entered' || state === 'auto' || state === 'excluded' ? state : ''
		});
	}
	return {
		status,
		message: text(raw.message),
		login: text(raw.login),
		at: isoText(raw.at),
		more: raw.more === true,
		repos
	};
}

/**
 * The choices that match a filter: every word in the name, without case, accents and umlaut dots
 * (the normalization of the TicketPicker, ADR-0042 §2). Own repositories first, then the others,
 * each in the order of the list.
 */
export function filterRepoChoices(
	choices: readonly GitHubRepoChoice[],
	query: string
): GitHubRepoChoice[] {
	const words = searchWords(query);
	const matching = choices.filter((choice) => {
		const name = normalizeSearch(choice.repo);
		return words.every((word) => name.includes(word));
	});
	return [...matching.filter((choice) => choice.own), ...matching.filter((choice) => !choice.own)];
}

/** What the list says about a repository besides its name, e.g. "privat, Fork". */
export function choiceNote(choice: GitHubRepoChoice): string {
	const parts: string[] = [];
	if (choice.state === 'entered') parts.push('schon eingetragen');
	if (choice.state === 'auto') parts.push('wird automatisch beobachtet');
	if (choice.state === 'excluded') parts.push('ausgeschlossen');
	if (choice.private) parts.push('privat');
	if (choice.archived) parts.push('archiviert');
	if (choice.fork) parts.push('Fork');
	if (choice.org) parts.push('Organisation');
	return parts.join(', ');
}

/**
 * A detail of an entry of GitHub from its `source_meta.github` (repository, path of a file), ''
 * when missing or not text.
 */
export function githubMetaText(
	item: { sourceMeta: Readonly<Record<string, unknown>> },
	key: 'repo' | 'path'
): string {
	const meta = item.sourceMeta.github;
	if (!isPlainObject(meta)) return '';
	const value = meta[key];
	return typeof value === 'string' ? value : '';
}

/** The events of a repository in words, e.g. "Dateien, Pull Requests"; "keine" without one. */
export function eventsText(events: GitHubEvents): string {
	const on = GITHUB_EVENTS.filter((event) => events[event]).map(
		(event) => GITHUB_EVENT_SHORT[event]
	);
	return on.length === 0 ? 'keine' : on.join(', ');
}

/** The interval in words: "alle 15 Minuten". */
export function intervalText(minutes: number): string {
	return minutes === 60 ? 'jede Stunde' : `alle ${minutes} Minuten`;
}

// --- Details of the card (GET /api/byl/connections/{id}/github) --------------------------------

export interface GitHubChange {
	path: string;
	action: 'changed' | 'added' | 'removed';
	at: string;
	url: string;
}

export interface GitHubRelease {
	tag: string;
	name: string;
	at: string;
	url: string;
	prerelease: boolean;
}

export interface GitHubRepoSummary {
	repo: string;
	key: string;
	/** Watched by "Alle meine Repositorys" with the defaults, not entered. */
	auto: boolean;
	url: string;
	branch: string;
	private: boolean;
	paths: readonly string[];
	events: GitHubEvents;
	target: string | null;
	/** Watched files and how many more match than are watched. */
	files: number;
	filesMore: number;
	/** The tree came truncated: removed files are not seen. */
	truncated: boolean;
	lastChange: GitHubChange | null;
	/** Open pull requests, null before the first run of the pull requests. */
	openPulls: number | null;
	openPullsMore: boolean;
	lastRelease: GitHubRelease | null;
	checkedAt: string | null;
	okAt: string | null;
	/** Error of the last run of this repository, '' without one. */
	error: string;
}

export interface GitHubRate {
	limit: number;
	remaining: number;
	/** ISO time of the reset, '' unknown. */
	reset: string;
}

/** A repository that left "Alle meine Repositorys", and why. */
export interface GitHubAutoRemoval {
	repo: string;
	reason: GitHubAutoReason;
}

/** How "Alle meine Repositorys" stands (addendum of 2026-10-02). */
export interface GitHubAutoDetails {
	enabled: boolean;
	/** Account of the token, '' before the first list. */
	login: string;
	/** When the server read the list (ISO), null before. */
	at: string | null;
	/** Repositories watched automatically, and own ones beyond the limit of 50. */
	count: number;
	more: number;
	/** The last change of the automatic set and when (ISO). */
	added: string[];
	removed: GitHubAutoRemoval[];
	changedAt: string | null;
	/** Why the list could not be read last time, '' without a problem. */
	error: string;
	excluded: string[];
}

export interface GitHubDetails {
	/** The server sees a token. */
	authenticated: boolean;
	interval: number;
	/** The watched repositories: entered ones, then the automatic ones. */
	repos: GitHubRepoSummary[];
	/** A rate limit holds until then (ISO). */
	limit: { until: string; kind: 'primary' | 'secondary' } | null;
	rate: GitHubRate | null;
	/** null while the server does not know "Alle meine Repositorys" (before the restart). */
	auto: GitHubAutoDetails | null;
}

function text(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

function count(value: unknown): number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

/** An instant as ISO text in UTC (what formatBerlinDateTime reads), null for anything else. */
function isoText(value: unknown): string | null {
	const raw = text(value);
	const ms = raw === '' ? NaN : Date.parse(raw.replace(' ', 'T'));
	return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function changeOf(value: unknown): GitHubChange | null {
	if (!isPlainObject(value)) return null;
	const action = value.action;
	if (action !== 'changed' && action !== 'added' && action !== 'removed') return null;
	const at = isoText(value.at);
	if (text(value.path) === '' || at === null) return null;
	return { path: text(value.path), action, at, url: text(value.url) };
}

function releaseOf(value: unknown): GitHubRelease | null {
	if (!isPlainObject(value) || text(value.tag) === '') return null;
	return {
		tag: text(value.tag),
		name: text(value.name),
		at: isoText(value.at) ?? '',
		url: text(value.url),
		prerelease: value.prerelease === true
	};
}

function rateOf(value: unknown): GitHubRate | null {
	if (!isPlainObject(value)) return null;
	const limit = typeof value.limit === 'number' ? value.limit : -1;
	if (limit <= 0) return null;
	const reset =
		typeof value.reset === 'number' && value.reset > 0
			? new Date(value.reset).toISOString()
			: (isoText(value.reset) ?? '');
	return { limit, remaining: typeof value.remaining === 'number' ? value.remaining : -1, reset };
}

/** The details of the card from the answer of the server, read strictly. */
export function githubDetailsOf(value: unknown): GitHubDetails {
	const raw = isPlainObject(value) ? value : {};
	const repos: GitHubRepoSummary[] = [];
	for (const entry of Array.isArray(raw.repos) ? raw.repos : []) {
		if (!isPlainObject(entry) || !isRepoName(entry.repo)) continue;
		const settings = githubSettingsOf({ repos: [entry] }).repos[0];
		if (settings === undefined) continue;
		repos.push({
			repo: entry.repo,
			key: repoKey(text(entry.key) || entry.repo),
			auto: entry.auto === true,
			url: /^https:\/\/github\.com\//.test(text(entry.url))
				? text(entry.url)
				: `https://github.com/${entry.repo}`,
			branch: text(entry.branch),
			private: entry.private === true,
			paths: settings.paths,
			events: settings.events,
			target: settings.target,
			files: count(entry.files),
			filesMore: count(entry.filesMore),
			truncated: entry.truncated === true,
			lastChange: changeOf(entry.lastChange),
			openPulls: typeof entry.openPulls === 'number' ? count(entry.openPulls) : null,
			openPullsMore: entry.openPullsMore === true,
			lastRelease: releaseOf(entry.lastRelease),
			checkedAt: isoText(entry.checkedAt),
			okAt: isoText(entry.okAt),
			error: text(entry.error)
		});
	}
	const limit =
		isPlainObject(raw.limit) && isoText(raw.limit.until) !== null
			? {
					until: isoText(raw.limit.until) ?? '',
					kind: raw.limit.kind === 'secondary' ? ('secondary' as const) : ('primary' as const)
				}
			: null;
	const interval = githubSettingsOf({ interval: raw.interval }).interval;
	return {
		authenticated: raw.authenticated === true,
		interval,
		repos,
		limit,
		rate: rateOf(raw.rate),
		auto: autoOf(raw.auto)
	};
}

function isAutoReason(value: string): value is GitHubAutoReason {
	return Object.keys(AUTO_REASONS).includes(value);
}

function namesOf(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((name): name is string => isRepoName(name)) : [];
}

function autoOf(value: unknown): GitHubAutoDetails | null {
	if (!isPlainObject(value)) return null;
	const removed: GitHubAutoRemoval[] = [];
	for (const entry of Array.isArray(value.removed) ? value.removed : []) {
		if (!isPlainObject(entry) || !isRepoName(entry.repo)) continue;
		const reason = text(entry.reason);
		if (isAutoReason(reason)) removed.push({ repo: entry.repo, reason });
	}
	return {
		enabled: value.enabled === true,
		login: text(value.login),
		at: isoText(value.at),
		count: count(value.count),
		more: count(value.more),
		added: namesOf(value.added),
		removed,
		changedAt: isoText(value.changedAt),
		error: text(value.error),
		excluded: namesOf(value.excluded)
	};
}

/**
 * "12 Repositorys von @anna, Liste vom 02.10.2026 10:05" with the ones over the limit; before the
 * first list "Die Liste deiner Repositorys holt der nächste Abruf."
 */
export function autoText(auto: GitHubAutoDetails): string {
	if (auto.at === null) return 'Die Liste deiner Repositorys holt der nächste Abruf.';
	const repos = auto.count === 1 ? '1 Repository' : `${auto.count} Repositorys`;
	const who = auto.login === '' ? '' : ` von @${auto.login}`;
	const more =
		auto.more > 0 ? `; ${auto.more} weitere über der Grenze von ${GITHUB_LIMITS.autoRepos}` : '';
	return `${repos}${who}${more}, Liste vom ${formatBerlinDateTime(auto.at)}`;
}

/** The last change of the automatic set, e.g. "02.10.2026 10:05: neu anna/a; nicht mehr anna/b (archiviert)"; null without one. */
export function autoChangeText(auto: GitHubAutoDetails): string | null {
	if (auto.changedAt === null || (auto.added.length === 0 && auto.removed.length === 0))
		return null;
	const parts: string[] = [];
	if (auto.added.length > 0) parts.push(`neu ${shortList(auto.added)}`);
	if (auto.removed.length > 0) {
		parts.push(
			`nicht mehr ${shortList(auto.removed.map((entry) => `${entry.repo} (${AUTO_REASONS[entry.reason]})`))}`
		);
	}
	return `${formatBerlinDateTime(auto.changedAt)}: ${parts.join('; ')}`;
}

function shortList(names: readonly string[]): string {
	const shown = names.slice(0, 5);
	const more = names.length - shown.length;
	return `${shown.join(', ')}${more > 0 ? ` und ${more} weitere` : ''}`;
}

/** What "Alle meine Repositorys beobachten" does, below the switch of the card and the assistant. */
export const AUTO_HINT =
	'Alle Repositorys deines Kontos, die das Token lesen darf, mit den Standard-Einstellungen; ohne Forks, archivierte und die von Organisationen. Neue kommen von selbst dazu, archivierte und gelöschte fallen weg; die Liste holt die App höchstens stündlich neu. Einzelne kannst du anpassen oder ausschließen.';

/** The switch without a token. */
export const AUTO_TOKEN_NEEDED =
	'Braucht ein Token: Ohne Token nennt GitHub keine Liste deiner Repositorys.';

/**
 * Whether a refusal of the settings with "Alle meine Repositorys" comes from hooks of before the
 * addendum (they know no key `auto` and answer validation_github_settings); the interface then
 * names the restart instead of "Unbekannte Einstellung".
 */
export function isAutoUnknown(error: string | null, auto: boolean): boolean {
	return auto && error === GITHUB_MESSAGES.validation_github_settings;
}

const ACTION_WORDS: Readonly<Record<GitHubChange['action'], string>> = Object.freeze({
	changed: 'geändert',
	added: 'neu',
	removed: 'gelöscht'
});

/** "CHANGELOG.md geändert, 02.10.2026 14:05"; "noch keine" without a change. */
export function lastChangeText(change: GitHubChange | null): string {
	if (change === null) return 'noch keine';
	return `${change.path} ${ACTION_WORDS[change.action]}, ${formatBerlinDateTime(change.at)}`;
}

/** "v1.2.0 (Vorabversion), 01.10.2026 10:00"; "noch keins" without one. */
export function releaseText(release: GitHubRelease | null): string {
	if (release === null) return 'noch keins';
	const pre = release.prerelease ? ' (Vorabversion)' : '';
	const at = release.at === '' ? '' : `, ${formatBerlinDateTime(release.at)}`;
	return `${release.tag}${pre}${at}`;
}

/** "3", "mehr als 1.000", "noch nicht abgerufen". */
export function openPullsText(
	summary: Pick<GitHubRepoSummary, 'openPulls' | 'openPullsMore'>
): string {
	if (summary.openPulls === null) return 'noch nicht abgerufen';
	return summary.openPullsMore ? `mehr als ${summary.openPulls}` : String(summary.openPulls);
}

/** "4 Dateien", "1 Datei", with the ones over the limit: "300 Dateien (12 weitere nicht beobachtet)". */
export function filesText(
	summary: Pick<GitHubRepoSummary, 'files' | 'filesMore' | 'truncated'>
): string {
	const files = summary.files === 1 ? '1 Datei' : `${summary.files} Dateien`;
	const more = summary.filesMore > 0 ? ` (${summary.filesMore} weitere nicht beobachtet)` : '';
	const truncated = summary.truncated
		? '; sehr großes Repository: gelöschte Dateien erkennt die App nicht'
		: '';
	return `${files}${more}${truncated}`;
}

/** Access of the connection: with token or only public repositories. */
export function accessText(authenticated: boolean, variable: string): string {
	return authenticated
		? `Token aus ${variable}, 5.000 Anfragen je Stunde`
		: `Ohne Token (${variable} nicht gesetzt): nur öffentliche Repositorys, 60 Anfragen je Stunde`;
}

/** The neutral hint of a connection without token. */
export const NO_TOKEN_HINT =
	'Ohne Token: nur öffentliche Repositorys, 60 Anfragen je Stunde. Für private Repositorys einen Token anlegen (Hilfe).';

/** Rate limit of GitHub as the details say it. */
export function rateText(details: Pick<GitHubDetails, 'rate' | 'limit'>): string {
	if (details.limit !== null) {
		return `erreicht, nächster Abruf ab ${formatBerlinDateTime(details.limit.until)}`;
	}
	if (details.rate === null) return 'noch nicht bekannt';
	const remaining = details.rate.remaining >= 0 ? details.rate.remaining : details.rate.limit;
	return `${formatThousands(remaining)} von ${formatThousands(details.rate.limit)} Anfragen übrig`;
}

function formatThousands(value: number): string {
	return String(Math.max(0, Math.trunc(value))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

// --- "Verbindung prüfen" (POST /api/byl/connections/{id}/github/check) --------------------------

export interface GitHubRepoCheck {
	repo: string;
	ok: boolean;
	name: string;
	private: boolean;
	message: string;
}

export interface GitHubCheck {
	status: 'ok' | 'error' | 'limited';
	authenticated: boolean;
	login: string;
	rate: GitHubRate | null;
	repos: GitHubRepoCheck[];
	message: string;
}

/** The answer of "Verbindung prüfen", read strictly. */
export function githubCheckOf(value: unknown): GitHubCheck {
	const raw = isPlainObject(value) ? value : {};
	const status = raw.status === 'ok' || raw.status === 'limited' ? raw.status : 'error';
	const repos: GitHubRepoCheck[] = [];
	for (const entry of Array.isArray(raw.repos) ? raw.repos : []) {
		if (!isPlainObject(entry) || !isRepoName(entry.repo)) continue;
		repos.push({
			repo: entry.repo,
			ok: entry.ok === true,
			name: isRepoName(entry.name) ? entry.name : entry.repo,
			private: entry.private === true,
			message: text(entry.message)
		});
	}
	return {
		status,
		authenticated: raw.authenticated === true,
		login: text(raw.login),
		rate: rateOf(raw.rate),
		repos,
		message: text(raw.message)
	};
}

/** Summary of "Verbindung prüfen" in one sentence and its tone (red only for an error, ADR-0009). */
export function checkSummary(check: GitHubCheck): {
	tone: 'success' | 'info' | 'error';
	text: string;
} {
	if (check.status === 'error') return { tone: 'error', text: check.message };
	if (check.status === 'limited') return { tone: 'info', text: check.message };
	const who = check.authenticated
		? check.login === ''
			? 'GitHub nimmt den Token an'
			: `GitHub nimmt den Token von @${check.login} an`
		: 'GitHub antwortet ohne Token (nur öffentliche Repositorys)';
	const rate =
		check.rate === null
			? ''
			: `, ${formatThousands(check.rate.remaining)} von ${formatThousands(check.rate.limit)} Anfragen übrig`;
	const failed = check.repos.filter((repo) => !repo.ok).length;
	const repos =
		check.repos.length === 0
			? ' Noch kein Repository eingetragen.'
			: failed === 0
				? ` ${check.repos.length === 1 ? 'Das Repository ist' : `Alle ${check.repos.length} Repositorys sind`} erreichbar.`
				: ` ${failed === 1 ? '1 Repository ist' : `${failed} Repositorys sind`} nicht erreichbar.`;
	return { tone: failed === 0 ? 'success' : 'info', text: `${who}${rate}.${repos}` };
}
