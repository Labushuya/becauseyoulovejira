// Fake of the GitHub REST API for the tests of the GitHub channel (ADR-0050), only on 127.0.0.1.
// It knows exactly the reading endpoints of the app (repository, branch, tree, blob, commits of a
// path, compare, pull requests, releases, user, the repositories of the user by affiliation, rate
// limit) and answers everything else, and every
// method but GET, with 404, so a writing request would show in the log and fail. Like GitHub it
// checks the token (a wrong one: 401; none: public repositories only, a private one is 404), the
// API version and the User-Agent, paginates with Link headers, answers If-None-Match with 304 for
// an unchanged answer (an authorized 304 does not count), counts the rate limit per token or for
// requests without one and answers 403 once it is used up. Chosen requests can get an injected
// failure (e.g. 429 with Retry-After) and every answer can wait (`slow`, for time limits).
// Repositories are a linear history of commits, each with all its files; dates come from a clock
// of the fake that runs a minute ahead of the real one and moves on by at least a second per
// change, so every change lies after a base the app took before. The log holds method, path,
// query, whether the request was authorized and conditional, the status and the time, never the
// Authorization header.

import { createHash } from 'node:crypto';
import { createServer } from 'node:http';

export const FAKE_GITHUB_VERSION = '2022-11-28';
/** The account of the valid token (GET /user); its repositories are the "own" ones. */
export const FAKE_GITHUB_LOGIN = 'anna';

const sha1 = (text) => createHash('sha1').update(text).digest('hex');
/** The blob SHA git gives a content. */
export const blobSha = (content) => sha1(`blob ${Buffer.byteLength(content)}\0${content}`);

function lines(text) {
	if (text === '') return [];
	const list = text.split('\n');
	if (list[list.length - 1] === '') list.pop();
	return list;
}

/** Line counts and a unified patch between two texts (longest common subsequence, small files). */
function diff(before, after) {
	const a = lines(before);
	const b = lines(after);
	const table = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
	for (let i = a.length - 1; i >= 0; i -= 1) {
		for (let j = b.length - 1; j >= 0; j -= 1) {
			table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
		}
	}
	const out = [];
	let i = 0;
	let j = 0;
	let additions = 0;
	let deletions = 0;
	while (i < a.length || j < b.length) {
		if (i < a.length && j < b.length && a[i] === b[j]) {
			out.push(` ${a[i]}`);
			i += 1;
			j += 1;
		} else if (j < b.length && (i === a.length || table[i][j + 1] >= table[i + 1][j])) {
			out.push(`+${b[j]}`);
			additions += 1;
			j += 1;
		} else {
			out.push(`-${a[i]}`);
			deletions += 1;
			i += 1;
		}
	}
	return { additions, deletions, patch: [`@@ -1,${a.length} +1,${b.length} @@`, ...out].join('\n') };
}

function send(response, status, body, headers = {}) {
	const text = body === undefined ? '' : JSON.stringify(body);
	response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
	response.end(text);
}

/**
 * Starts the fake. `options`: { token (the valid token), limits: { token, anonymous } (requests
 * per hour, default 5000 and 60) }.
 */
export async function startFakeGitHub(options) {
	const requests = [];
	// Every method that ever arrived, kept over clear(): the app may send GET only.
	const methods = new Set();
	const repos = new Map();
	let injections = [];
	let granted = null;
	let delayMs = 0;
	let clock = Math.ceil(Date.now() / 1000) * 1000 + 60_000;
	const limits = { token: options.limits?.token ?? 5000, anonymous: options.limits?.anonymous ?? 60 };
	const rates = {
		token: { remaining: limits.token, reset: Math.floor(Date.now() / 1000) + 3600 },
		anonymous: { remaining: limits.anonymous, reset: Math.floor(Date.now() / 1000) + 3600 }
	};
	let ids = 1000;

	/** The next instant of the fake (ISO, whole seconds). */
	function tick(date) {
		clock = Math.max(clock + 1000, Math.ceil(Date.now() / 1000) * 1000 + 60_000);
		if (date !== undefined) clock = Math.max(clock, Date.parse(date));
		return new Date(clock).toISOString().replace(/\.\d{3}Z$/, 'Z');
	}

	function repoOf(name) {
		const repo = repos.get(name.toLowerCase());
		if (repo === undefined) throw new Error(`fake-github: unknown repository ${name}`);
		return repo;
	}

	function headOf(repo) {
		return repo.commits[repo.commits.length - 1];
	}

	const api = {
		/**
		 * A repository with a first commit of `files` ({ path: content }). `org` makes its owner an
		 * organization; `fork` and `archived` mark it like GitHub. The user of the token is LOGIN.
		 */
		addRepo(
			name,
			{ files = {}, private: isPrivate = false, branch = 'main', empty = false, org = false, fork = false, archived = false } = {}
		) {
			const [owner, short] = name.split('/');
			ids += 1;
			const repo = {
				id: ids,
				node_id: `R_fake${ids}`,
				name: short,
				owner,
				owner_type: org ? 'Organization' : 'User',
				full_name: name,
				private: isPrivate,
				fork,
				archived,
				default_branch: branch,
				commits: [],
				pulls: [],
				releases: []
			};
			repos.set(name.toLowerCase(), repo);
			if (!empty) api.commit(name, { files, message: 'Initial commit' });
			return repo;
		},
		/** A new commit on the default branch: `files` maps paths to new content, null removes one. */
		commit(name, { files = {}, message = 'Change', author = 'Anna Beispiel', login = 'anna', date } = {}) {
			const repo = repoOf(name);
			const parent = repo.commits.length === 0 ? null : headOf(repo);
			const next = { ...(parent?.files ?? {}) };
			for (const [path, content] of Object.entries(files)) {
				if (content === null) delete next[path];
				else next[path] = content;
			}
			ids += 1;
			const commit = { sha: sha1(`commit ${ids} ${message}`), parent: parent?.sha ?? null, date: tick(date), message, author, login, files: next };
			repo.commits.push(commit);
			return commit;
		},
		/** Moves the default branch to a history that no longer holds the old head (force push). */
		rewrite(name) {
			const repo = repoOf(name);
			const head = headOf(repo);
			ids += 1;
			const commit = { ...head, sha: sha1(`rewrite ${ids}`), parent: null, date: tick() };
			repo.commits = [commit];
			return commit;
		},
		/** Renames the default branch (the old name answers 404). */
		renameBranch(name, branch) {
			repoOf(name).default_branch = branch;
		},
		/** Archives a repository (or takes it out of the archive with `false`). */
		archive(name, archived = true) {
			repoOf(name).archived = archived;
		},
		/** Deletes a repository: every request about it answers 404. */
		removeRepo(name) {
			repoOf(name);
			repos.delete(name.toLowerCase());
		},
		/**
		 * Like a fine-grained token with "Only select repositories": GET /user/repos lists only these
		 * (null: every repository, like "All repositories" or a classic token).
		 */
		grantOnly(names) {
			granted = names === null ? null : new Set(names.map((name) => name.toLowerCase()));
		},
		openPull(name, { title = 'Neuer PR', body = '', login = 'ben', draft = false, head = 'feature', date } = {}) {
			const repo = repoOf(name);
			ids += 1;
			const at = tick(date);
			const pull = {
				number: repo.pulls.length + 1,
				node_id: `PR_fake${ids}`,
				title,
				body,
				state: 'open',
				draft,
				user: { login },
				created_at: at,
				updated_at: at,
				closed_at: null,
				merged_at: null,
				head: { ref: head },
				base: { ref: repo.default_branch }
			};
			repo.pulls.push(pull);
			return pull;
		},
		/** Merges, closes, reopens or edits a pull request; every change moves updated_at. */
		updatePull(name, number, change) {
			const pull = repoOf(name).pulls.find((entry) => entry.number === number);
			const at = tick();
			pull.updated_at = at;
			if (change === 'merge') {
				pull.state = 'closed';
				pull.merged_at = at;
				pull.closed_at = at;
			} else if (change === 'close') {
				pull.state = 'closed';
				pull.closed_at = at;
			} else if (change === 'reopen') {
				pull.state = 'open';
				pull.closed_at = null;
			} else if (typeof change === 'object') {
				Object.assign(pull, change);
			}
			return pull;
		},
		publishRelease(name, { tag, title = '', body = '', prerelease = false, draft = false, login = 'anna', date } = {}) {
			const repo = repoOf(name);
			ids += 1;
			const at = tick(date);
			const release = {
				id: ids,
				node_id: `RE_fake${ids}`,
				tag_name: tag,
				name: title,
				body,
				draft,
				prerelease,
				created_at: at,
				published_at: draft ? null : at,
				author: { login }
			};
			repo.releases.push(release);
			return release;
		},
		/** Sets the rate limit of requests with the token or without one. */
		setRate(kind, remaining, resetSeconds) {
			rates[kind].remaining = remaining;
			if (resetSeconds !== undefined) rates[kind].reset = resetSeconds;
		},
		rate(kind) {
			return { ...rates[kind] };
		},
		/** Answers the next `times` requests of a path matching `path` with a failure. */
		inject(rule) {
			injections.push({ times: 1, headers: {}, body: { message: 'Injected failure.' }, ...rule });
		},
		slow(ms) {
			delayMs = ms;
		},
		clear() {
			requests.length = 0;
			injections = [];
			delayMs = 0;
		},
		requests
	};

	function page(list, url, perPageDefault = 30) {
		const perPage = Math.min(Number(url.searchParams.get('per_page') ?? perPageDefault) || perPageDefault, 100);
		const number = Math.max(Number(url.searchParams.get('page') ?? 1) || 1, 1);
		const start = (number - 1) * perPage;
		const items = list.slice(start, start + perPage);
		const headers = {};
		const last = Math.max(Math.ceil(list.length / perPage), 1);
		if (number < last) {
			const next = new URL(url.toString());
			next.searchParams.set('page', String(number + 1));
			const end = new URL(url.toString());
			end.searchParams.set('page', String(last));
			headers.Link = `<${next.toString()}>; rel="next", <${end.toString()}>; rel="last"`;
		}
		return { items, headers };
	}

	function commitJson(repo, commit) {
		return {
			sha: commit.sha,
			node_id: `C_${commit.sha.slice(0, 10)}`,
			commit: {
				message: commit.message,
				author: { name: commit.author, email: `${commit.login}@example.com`, date: commit.date },
				committer: { name: commit.author, email: `${commit.login}@example.com`, date: commit.date }
			},
			author: { login: commit.login },
			html_url: `https://github.com/${repo.full_name}/commit/${commit.sha}`,
			parents: commit.parent === null ? [] : [{ sha: commit.parent }]
		};
	}

	function treeOf(commit) {
		const entries = [];
		const folders = new Set();
		for (const [path, content] of Object.entries(commit.files).sort(([a], [b]) => (a < b ? -1 : 1))) {
			const parts = path.split('/');
			for (let i = 1; i < parts.length; i += 1) {
				const folder = parts.slice(0, i).join('/');
				if (!folders.has(folder)) {
					folders.add(folder);
					entries.push({ path: folder, mode: '040000', type: 'tree', sha: sha1(`tree ${folder}`) });
				}
			}
			entries.push({ path, mode: '100644', type: 'blob', sha: blobSha(content), size: Buffer.byteLength(content) });
		}
		return entries;
	}

	function route(method, path, url, authorized, response, context) {
		let match;
		if (method !== 'GET') return send(response, 404, { message: 'Not Found' });
		if (path === '/rate_limit') {
			const rate = rates[context.identity];
			const limit = context.identity === 'token' ? limits.token : limits.anonymous;
			const core = { limit, remaining: rate.remaining, reset: rate.reset, used: limit - rate.remaining };
			return send(response, 200, { resources: { core }, rate: core });
		}
		if (path === '/user') {
			if (!authorized) return send(response, 401, { message: 'Requires authentication' });
			return send(response, 200, { login: FAKE_GITHUB_LOGIN, id: 1, type: 'User' });
		}
		if (path === '/user/repos') {
			// The repositories of the token by affiliation (owner, collaborator, organization_member;
			// default all three), sorted by full_name, paginated like every list.
			if (!authorized) return send(response, 401, { message: 'Requires authentication' });
			const wanted = (url.searchParams.get('affiliation') ?? 'owner,collaborator,organization_member').split(',');
			const affiliation = (repo) =>
				repo.owner_type === 'Organization'
					? 'organization_member'
					: repo.owner.toLowerCase() === FAKE_GITHUB_LOGIN
						? 'owner'
						: 'collaborator';
			const list = [...repos.values()]
				.filter((repo) => wanted.includes(affiliation(repo)))
				.filter((repo) => granted === null || granted.has(repo.full_name.toLowerCase()))
				.sort((a, b) => (a.full_name.toLowerCase() < b.full_name.toLowerCase() ? -1 : 1))
				.map((repo) => ({
					id: repo.id,
					node_id: repo.node_id,
					name: repo.name,
					full_name: repo.full_name,
					private: repo.private,
					owner: { login: repo.owner, type: repo.owner_type },
					fork: repo.fork,
					archived: repo.archived,
					default_branch: repo.default_branch,
					pushed_at: repo.commits.length === 0 ? null : headOf(repo).date,
					html_url: `https://github.com/${repo.full_name}`
				}));
			const result = page(list, url);
			return send(response, 200, result.items, { ...context.headers, ...result.headers });
		}
		if (!(match = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(path))) return send(response, 404, { message: 'Not Found' });
		const repo = repos.get(`${decodeURIComponent(match[1])}/${decodeURIComponent(match[2])}`.toLowerCase());
		if (repo === undefined || (repo.private && !authorized)) return send(response, 404, { message: 'Not Found' });
		const rest = match[3] ?? '';
		if (rest === '') {
			return send(response, 200, {
				id: repo.id,
				node_id: repo.node_id,
				name: repo.name,
				full_name: repo.full_name,
				private: repo.private,
				fork: repo.fork,
				archived: repo.archived,
				default_branch: repo.default_branch,
				html_url: `https://github.com/${repo.full_name}`
			});
		}
		if (repo.commits.length === 0) return send(response, 409, { message: 'Git Repository is empty.' });
		const head = headOf(repo);
		if ((match = /^\/branches\/(.+)$/.exec(rest))) {
			if (decodeURIComponent(match[1]) !== repo.default_branch) return send(response, 404, { message: 'Branch not found' });
			return send(response, 200, { name: repo.default_branch, commit: commitJson(repo, head), protected: false });
		}
		if ((match = /^\/git\/trees\/([0-9a-f]{40})$/.exec(rest))) {
			const commit = repo.commits.find((entry) => entry.sha === match[1]);
			if (commit === undefined) return send(response, 404, { message: 'Not Found' });
			return send(response, 200, { sha: sha1(`root ${commit.sha}`), tree: treeOf(commit), truncated: context.truncateTrees === true });
		}
		if ((match = /^\/git\/blobs\/([0-9a-f]{40})$/.exec(rest))) {
			const content = repo.commits.flatMap((commit) => Object.values(commit.files)).find((value) => blobSha(value) === match[1]);
			if (content === undefined) return send(response, 404, { message: 'Not Found' });
			if (context.accept === 'application/vnd.github.raw+json') {
				response.writeHead(200, { 'Content-Type': 'application/vnd.github.raw; charset=utf-8', ...context.headers });
				return response.end(content);
			}
			return send(response, 200, { sha: match[1], size: Buffer.byteLength(content), encoding: 'base64', content: Buffer.from(content).toString('base64') });
		}
		if (rest === '/commits') {
			const filePath = url.searchParams.get('path');
			const since = url.searchParams.get('since');
			const start = url.searchParams.get('sha') ?? head.sha;
			let index = repo.commits.findIndex((entry) => entry.sha === start || repo.default_branch === start);
			if (index === -1) return send(response, 404, { message: 'No commit found' });
			if (repo.default_branch === start) index = repo.commits.length - 1;
			const list = [];
			for (let i = index; i >= 0; i -= 1) {
				const commit = repo.commits[i];
				const parent = i > 0 ? repo.commits[i - 1] : null;
				if (since !== null && Date.parse(commit.date) < Date.parse(since)) break;
				if (filePath !== null && (commit.files[filePath] ?? null) === (parent?.files[filePath] ?? null)) continue;
				list.push(commitJson(repo, commit));
			}
			const result = page(list, url);
			return send(response, 200, result.items, { ...context.headers, ...result.headers });
		}
		if ((match = /^\/compare\/([0-9a-f]{40})\.\.\.([0-9a-f]{40})$/.exec(rest))) {
			const from = repo.commits.findIndex((entry) => entry.sha === match[1]);
			const to = repo.commits.findIndex((entry) => entry.sha === match[2]);
			if (from === -1 || to === -1) return send(response, 404, { message: 'Not Found' });
			const before = repo.commits[from].files;
			const after = repo.commits[to].files;
			const files = [];
			for (const filename of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
				if (before[filename] === after[filename]) continue;
				const status = before[filename] === undefined ? 'added' : after[filename] === undefined ? 'removed' : 'modified';
				const change = diff(before[filename] ?? '', after[filename] ?? '');
				files.push({ filename, status, additions: change.additions, deletions: change.deletions, changes: change.additions + change.deletions, patch: change.patch, sha: after[filename] === undefined ? null : blobSha(after[filename]) });
			}
			return send(response, 200, {
				status: 'ahead',
				ahead_by: to - from,
				total_commits: to - from,
				commits: repo.commits.slice(from + 1, to + 1).map((commit) => commitJson(repo, commit)),
				files,
				html_url: `https://github.com/${repo.full_name}/compare/${match[1]}...${match[2]}`
			});
		}
		if (rest === '/pulls') {
			const state = url.searchParams.get('state') ?? 'open';
			const sort = url.searchParams.get('sort') ?? 'created';
			const direction = url.searchParams.get('direction') ?? 'desc';
			const key = sort === 'updated' ? 'updated_at' : 'created_at';
			const list = repo.pulls
				.filter((pull) => state === 'all' || pull.state === state)
				.sort((a, b) => (a[key] === b[key] ? b.number - a.number : a[key] < b[key] ? 1 : -1) * (direction === 'asc' ? -1 : 1))
				.map((pull) => ({ ...pull, html_url: `https://github.com/${repo.full_name}/pull/${pull.number}` }));
			const result = page(list, url);
			return send(response, 200, result.items, { ...context.headers, ...result.headers });
		}
		if (rest === '/releases') {
			const list = [...repo.releases].sort((a, b) => (a.created_at === b.created_at ? b.id - a.id : a.created_at < b.created_at ? 1 : -1));
			const result = page(list, url);
			return send(response, 200, result.items, { ...context.headers, ...result.headers });
		}
		return send(response, 404, { message: 'Not Found' });
	}

	let truncateTrees = false;
	const server = createServer(async (request, response) => {
		const url = new URL(request.url ?? '/', `http://127.0.0.1:${server.address().port}`);
		const method = request.method ?? 'GET';
		const path = url.pathname;
		const authorization = request.headers.authorization;
		const authorized = authorization === `Bearer ${options.token}`;
		const conditional = typeof request.headers['if-none-match'] === 'string';
		const entry = { method, path, query: Object.fromEntries(url.searchParams), authorized, conditional, status: 0, at: Date.now() };
		requests.push(entry);
		methods.add(method);
		for await (const chunk of request) void chunk;
		if (delayMs > 0) {
			await new Promise((resolve) => setTimeout(resolve, delayMs));
			if (response.destroyed) return;
		}
		const identity = authorized ? 'token' : 'anonymous';
		const rate = rates[identity];
		const rateHeaders = () => ({
			'x-ratelimit-limit': String(identity === 'token' ? limits.token : limits.anonymous),
			'x-ratelimit-remaining': String(Math.max(rate.remaining, 0)),
			'x-ratelimit-reset': String(rate.reset),
			'x-ratelimit-used': String((identity === 'token' ? limits.token : limits.anonymous) - Math.max(rate.remaining, 0)),
			'x-ratelimit-resource': 'core'
		});
		const original = response.writeHead.bind(response);
		response.writeHead = (status, headers) => {
			entry.status = status;
			return original(status, headers);
		};
		if (authorization !== undefined && !authorized) {
			return send(response, 401, { message: 'Bad credentials' }, rateHeaders());
		}
		if (!/becauseyoulovejira/.test(request.headers['user-agent'] ?? '')) {
			return send(response, 403, { message: 'Request forbidden by administrative rules. Please make sure your request has a User-Agent header.' });
		}
		if (request.headers['x-github-api-version'] !== FAKE_GITHUB_VERSION) {
			return send(response, 400, { message: 'Unsupported API version' });
		}
		const injected = injections.find((rule) => rule.path.test(path) && rule.times > 0);
		if (injected !== undefined) {
			injected.times -= 1;
			return send(response, injected.status, injected.body, { ...rateHeaders(), ...injected.headers });
		}
		if (path !== '/rate_limit') {
			if (rate.remaining <= 0) {
				return send(response, 403, { message: `API rate limit exceeded for ${identity}.` }, rateHeaders());
			}
		}
		// Collect the answer first: its ETag decides between 200 and 304.
		let status = 200;
		let body = '';
		let headers = {};
		const capture = {
			writeHead(code, values) {
				status = code;
				headers = values ?? {};
			},
			end(text) {
				body = text ?? '';
			},
			get destroyed() {
				return response.destroyed;
			}
		};
		route(method, path, url, authorized, capture, { identity, accept: request.headers.accept, headers: {}, truncateTrees });
		const etag = `W/"${sha1(`${body}`)}"`;
		if (status === 200 && conditional && request.headers['if-none-match'] === etag) {
			if (!authorized && path !== '/rate_limit') rate.remaining -= 1;
			response.writeHead(304, { ETag: etag, ...rateHeaders() });
			return response.end();
		}
		if (path !== '/rate_limit') rate.remaining -= 1;
		response.writeHead(status, { ...headers, ...rateHeaders(), ...(status === 200 ? { ETag: etag } : {}) });
		response.end(body);
	});

	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	return {
		...api,
		port: typeof address === 'object' && address !== null ? address.port : 0,
		/** Every HTTP method that arrived since the start. */
		methods: () => [...methods].sort(),
		/** Further trees come back marked as truncated (GitHub does that above 100 000 entries). */
		truncate(value) {
			truncateTrees = value;
		},
		close: () =>
			new Promise((resolve) => {
				server.closeAllConnections();
				server.close(() => resolve());
			})
	};
}
