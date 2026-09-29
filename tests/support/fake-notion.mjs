// Fake of the Notion REST API for the tests of the import (ADR-0041), only on 127.0.0.1. It knows
// exactly the reading endpoints of the app (users/me, search, data sources and their query,
// pages, block children) and answers everything else with 404, so a writing request would show in
// the log and fail. It checks the token and the Notion-Version like Notion, paginates with a small
// page size, hides what is not shared (404), can answer chosen requests with an injected failure
// (e.g. 429 with Retry-After) and can answer slowly (`slow`, for time limits). The log holds
// method, path, query, version and arrival time per request, never the Authorization header.

import { createServer } from 'node:http';

export const FAKE_NOTION_VERSION = '2026-03-11';

function send(response, status, body, headers = {}) {
	response.writeHead(status, { 'Content-Type': 'application/json', ...headers });
	response.end(JSON.stringify(body));
}

function error(response, status, code, message, headers) {
	send(response, status, { object: 'error', status, code, message }, headers);
}

function plain(richText) {
	return (richText ?? []).map((item) => item.plain_text ?? '').join('');
}

function titleOf(object) {
	if (object.object === 'data_source') return plain(object.title);
	const property = Object.values(object.properties ?? {}).find((value) => value.type === 'title');
	return plain(property?.title);
}

/** Pages of `list` from the cursor ("n" = start index) with at most `size` results. */
function paginate(list, cursor, size) {
	const start = cursor === undefined || cursor === '' ? 0 : Number(cursor);
	const results = list.slice(start, start + size);
	const next = start + size < list.length ? String(start + size) : null;
	return { object: 'list', results, next_cursor: next, has_more: next !== null };
}

async function readBody(request) {
	const chunks = [];
	for await (const chunk of request) chunks.push(chunk);
	const text = Buffer.concat(chunks).toString('utf8');
	if (text === '') return {};
	return JSON.parse(text);
}

/**
 * Starts the fake. `workspace`: { token, bot: { name, workspace_name }, dataSources: { id: object },
 * rows: { dataSourceId: [page] }, pages: { id: page }, children: { id: [block] }, shared: Set of
 * the IDs of shared data sources and pages, pageSize }. Rows count as shared with their data
 * source, blocks with their page.
 * @returns {Promise<{ port: number, requests: object[], inject: (rule: object) => void, slow: (ms: number) => void, clear: () => void, close: () => Promise<void> }>}
 */
export async function startFakeNotion(workspace) {
	const requests = [];
	let injections = [];
	let delayMs = 0;
	const size = workspace.pageSize ?? 100;
	const rowIds = new Set(Object.values(workspace.rows).flatMap((rows) => rows.map((row) => row.id)));
	const pages = { ...workspace.pages };
	for (const rows of Object.values(workspace.rows)) for (const row of rows) pages[row.id] = row;

	const visiblePage = (id) =>
		pages[id] !== undefined &&
		(workspace.shared.has(id) ||
			(rowIds.has(id) && Object.entries(workspace.rows).some(([source, rows]) => workspace.shared.has(source) && rows.some((row) => row.id === id))));

	const server = createServer(async (request, response) => {
		const url = new URL(request.url ?? '/', 'http://127.0.0.1');
		const path = url.pathname;
		const method = request.method ?? 'GET';
		let body = {};
		try {
			body = await readBody(request);
		} catch {
			error(response, 400, 'invalid_json', 'Body failed to parse.');
			return;
		}
		requests.push({ method, path, query: Object.fromEntries(url.searchParams), version: request.headers['notion-version'] ?? '', body, at: Date.now() });
		if (delayMs > 0) {
			await new Promise((resolve) => setTimeout(resolve, delayMs));
			if (response.destroyed) return;
		}

		const injected = injections.find((rule) => rule.method === method && rule.path.test(path) && rule.times > 0);
		if (injected !== undefined) {
			injected.times -= 1;
			error(response, injected.status, injected.code, 'Injected failure.', injected.headers);
			return;
		}
		if (request.headers.authorization !== `Bearer ${workspace.token}`) {
			error(response, 401, 'unauthorized', 'API token is invalid.');
			return;
		}
		if (request.headers['notion-version'] !== FAKE_NOTION_VERSION) {
			error(response, 400, 'missing_version', 'Notion-Version header failed validation.');
			return;
		}

		let match;
		if (method === 'GET' && path === '/v1/users/me') {
			send(response, 200, {
				object: 'user',
				id: '00000000-0000-4000-8000-000000000b07',
				type: 'bot',
				name: workspace.bot.name,
				bot: { owner: { type: 'workspace', workspace: true }, workspace_name: workspace.bot.workspace_name }
			});
			return;
		}
		if (method === 'POST' && path === '/v1/search') {
			const wanted = body.filter?.value;
			const query = String(body.query ?? '').toLowerCase();
			const all = [
				...Object.values(workspace.dataSources).filter((source) => workspace.shared.has(source.id)),
				...Object.values(pages).filter((page) => visiblePage(page.id))
			]
				.filter((object) => wanted === undefined || object.object === wanted)
				.filter((object) => query === '' || titleOf(object).toLowerCase().includes(query))
				.sort((a, b) => (a.last_edited_time < b.last_edited_time ? 1 : -1));
			send(response, 200, { ...paginate(all, body.start_cursor, Math.min(size, body.page_size ?? 100)), type: 'page_or_data_source' });
			return;
		}
		if (method === 'GET' && (match = /^\/v1\/data_sources\/([0-9a-f-]{36})$/.exec(path))) {
			const source = workspace.dataSources[match[1]];
			if (source === undefined || !workspace.shared.has(match[1])) {
				error(response, 404, 'object_not_found', 'Could not find data_source.');
				return;
			}
			send(response, 200, source);
			return;
		}
		if (method === 'POST' && (match = /^\/v1\/data_sources\/([0-9a-f-]{36})\/query$/.exec(path))) {
			if (workspace.dataSources[match[1]] === undefined || !workspace.shared.has(match[1])) {
				error(response, 404, 'object_not_found', 'Could not find data_source.');
				return;
			}
			const rows = [...(workspace.rows[match[1]] ?? [])].sort((a, b) => (a.created_time < b.created_time ? -1 : 1));
			send(response, 200, { ...paginate(rows, body.start_cursor, Math.min(size, body.page_size ?? 100)), type: 'page_or_data_source' });
			return;
		}
		if (method === 'GET' && (match = /^\/v1\/pages\/([0-9a-f-]{36})$/.exec(path))) {
			if (!visiblePage(match[1])) {
				error(response, 404, 'object_not_found', 'Could not find page.');
				return;
			}
			send(response, 200, pages[match[1]]);
			return;
		}
		if (method === 'GET' && (match = /^\/v1\/blocks\/([0-9a-f-]{36})\/children$/.exec(path))) {
			const children = workspace.children[match[1]];
			if (children === undefined && pages[match[1]] === undefined) {
				error(response, 404, 'object_not_found', 'Could not find block.');
				return;
			}
			const listed = (children ?? []).map((block) => ({ ...block, has_children: (workspace.children[block.id] ?? []).length > 0 }));
			send(response, 200, { ...paginate(listed, url.searchParams.get('start_cursor') ?? '', Math.min(size, Number(url.searchParams.get('page_size') ?? 100))), type: 'block' });
			return;
		}
		error(response, 404, 'invalid_request_url', 'Invalid request URL.');
	});

	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	return {
		port: typeof address === 'object' && address !== null ? address.port : 0,
		requests,
		/** Answers the next `times` requests of `method` on a path matching `path` with a failure. */
		inject(rule) {
			injections.push({ times: 1, headers: {}, code: 'injected', ...rule });
		},
		/** Every following answer waits `ms` first (0: at once); `clear` resets it. */
		slow(ms) {
			delayMs = ms;
		},
		clear() {
			requests.length = 0;
			injections = [];
			delayMs = 0;
		},
		close: () =>
			new Promise((resolve) => {
				server.closeAllConnections();
				server.close(() => resolve());
			})
	};
}
