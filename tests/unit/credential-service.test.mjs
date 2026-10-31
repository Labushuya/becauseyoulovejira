// lib/credential-service.js with stubs instead of the control script (BW-3, ADR-0075 §5): the mark
// "a change waits for a restart" stands also after an answer of the script that is none (the
// variable may have changed before it failed), and setting and removing run one at a time with the
// actions of the page System (RUNNING_KEY of lib/system-service.js, its real `claim`). No server
// and no script run here: the checks, the own instance and the command are stubs, the store, the
// log and the request fakes.

import { readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInThisContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';

const HOOKS_DIR = resolve(fileURLToPath(new URL('../../app/pb_hooks', import.meta.url)));
const systemRules = loadHookLib('system-rules.js');
const credentialRules = loadHookLib('credential-rules.js');
const VALUE = 'Marker-Wert-4b81';

/** A module of pb_hooks/lib as the Goja runtime loads it, `require` answering `stubs` first. */
function loadWith(name, stubs) {
	const filename = join(HOOKS_DIR, 'lib', name);
	const factory = runInThisContext(`(function (module, exports, require, __hooks) {${readFileSync(filename, 'utf8')}\n})`, { filename });
	const module = { exports: {} };
	const require = (path) => stubs[basename(path)] ?? loadHookLib(basename(path));
	factory(module, module.exports, require, HOOKS_DIR);
	return module.exports;
}

/** $app.store() in memory. */
function memoryStore() {
	const values = new Map();
	return {
		values,
		get: (key) => values.get(key),
		set: (key, value) => void values.set(key, value),
		remove: (key) => void values.delete(key),
		setFunc: (key, update) => void values.set(key, update(values.get(key)))
	};
}

/**
 * The service on a store, with the real system-service.js whose checks, own instance and command
 * are stubs: every check passes, the instance is own, and the command answers `answer`.
 */
function serviceOf(store, answer) {
	const commands = [];
	const real = loadWith('system-service.js', { 'account-service.js': { isInstanceAdmin: () => true } });
	const system = {
		...real,
		check: () => ({ appDir: '' }),
		ownAppDir: () => 'C:\\Test\\app',
		isAdminRequest: () => true,
		runJson: (appDir, action, input) => {
			commands.push({ action, input });
			return typeof answer === 'function' ? answer() : answer;
		}
	};
	const service = loadWith('credential-service.js', {
		'system-service.js': system,
		'connection-service.js': { variableNamesOf: () => [] }
	});
	const request = (body) => ({
		app: {
			store: () => store,
			logger: () => ({ info: () => undefined, warn: () => undefined }),
			findRecordsByFilter: () => []
		},
		auth: { id: 'u0000000000000a' },
		remoteIP: () => '127.0.0.1',
		requestInfo: () => ({ body }),
		response: { header: () => ({ set: () => undefined }) },
		json: (status, data) => ({ status, data })
	});
	return { service, commands, request };
}

describe('the mark of a change (ADR-0075 §5)', () => {
	it('stands also when the control script gives no readable answer', () => {
		const store = memoryStore();
		const { service, commands, request } = serviceOf(store, null);
		const answer = service.set(request({ name: 'BYL_TELEGRAM_TOKEN', value: VALUE }));
		expect([answer.status, answer.data.reason]).toEqual([502, 'script']);
		expect(commands).toEqual([{ action: 'credential-set', input: { name: 'BYL_TELEGRAM_TOKEN', value: VALUE } }]);
		expect(service.notice(request(null))).toEqual({ status: 200, data: { needed: true } });
		expect(JSON.stringify(answer)).not.toContain(VALUE);
		// The claim is given back.
		expect(store.values.has(systemRules.RUNNING_KEY)).toBe(false);
	});

	it('stands after a change and not after a refusal of the script', () => {
		const refused = memoryStore();
		const refusal = serviceOf(refused, { ok: false, problem: 'control' });
		expect(refusal.service.remove(refusal.request({ name: 'BYL_TELEGRAM_TOKEN' })).status).toBe(400);
		expect(refusal.service.notice(refusal.request(null)).data).toEqual({ needed: false });

		const changed = memoryStore();
		const change = serviceOf(changed, { ok: true, name: 'BYL_TELEGRAM_TOKEN' });
		expect(change.service.remove(change.request({ name: 'BYL_TELEGRAM_TOKEN' }))).toEqual({
			status: 200,
			data: { name: 'BYL_TELEGRAM_TOKEN', set: false, restartNeeded: true }
		});
		expect(changed.get(credentialRules.RESTART_NOTICE_KEY)).toEqual(expect.any(Number));
		expect(changed.values.has(systemRules.RUNNING_KEY)).toBe(false);
	});
});

describe('one command at a time with the page System', () => {
	it('refuses a change while another command holds the claim, and leaves that claim alone', () => {
		const store = memoryStore();
		const since = Date.now();
		store.set(systemRules.RUNNING_KEY, since);
		const { service, commands, request } = serviceOf(store, { ok: true });
		const answer = service.set(request({ name: 'BYL_TELEGRAM_TOKEN', value: VALUE }));
		expect([answer.status, answer.data.reason]).toEqual([409, 'busy']);
		expect(commands).toEqual([]);
		expect(store.get(systemRules.RUNNING_KEY)).toBe(since);
		expect(store.values.has(credentialRules.RESTART_NOTICE_KEY)).toBe(false);
	});

	it('refuses a change once a restart was started, and gives the claim back', () => {
		const store = memoryStore();
		store.set(systemRules.RESTART_KEY, Date.now());
		const { service, commands, request } = serviceOf(store, { ok: true });
		const answer = service.remove(request({ name: 'BYL_TELEGRAM_TOKEN' }));
		expect([answer.status, answer.data.reason]).toEqual([409, 'busy']);
		expect(commands).toEqual([]);
		expect(store.values.has(systemRules.RUNNING_KEY)).toBe(false);
	});

	it('holds the claim while the command runs, so an action of the page System waits', () => {
		const store = memoryStore();
		let held = null;
		const { service, request } = serviceOf(store, () => {
			held = store.get(systemRules.RUNNING_KEY);
			return { ok: true };
		});
		expect(service.set(request({ name: 'BYL_TELEGRAM_TOKEN', value: VALUE })).status).toBe(200);
		expect(held).toEqual(expect.any(Number));
		expect(store.values.has(systemRules.RUNNING_KEY)).toBe(false);
	});
});
