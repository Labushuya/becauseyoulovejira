// The GitHub channel only reads (ADR-0050 §1): statically, the client of the API sends GET and
// nothing else, it is the only place that sends a request to GitHub, and no module of the channel
// names another method. The integration test (tests/integration/github-channel.test.mjs) checks
// the same at the fake server: every request that arrived was a GET.

import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const HOOKS = new URL('../../app/pb_hooks/', import.meta.url);
const read = (path) => readFileSync(new URL(path, HOOKS), 'utf8');
// Code without comments, so a sentence like "never POST" does not count.
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const CHANNEL_FILES = ['github.pb.js', 'lib/github-client.js', 'lib/github-service.js', 'lib/github-rules.js'];
const WRITING = /\b(?:POST|PUT|PATCH|DELETE)\b/;

describe('GitHub channel: read only', () => {
	it('sends every request through the client, with the method GET', () => {
		const client = code(read('lib/github-client.js'));
		const sends = client.match(/\$http\.send\(/g) ?? [];
		expect(sends).toHaveLength(1);
		expect(client).toMatch(/\$http\.send\(\{ url: base \+ path, method: 'GET', headers: headers, timeout: seconds \}\)/);
		expect(client.match(/method:/g)).toHaveLength(1);
	});

	it('names no writing method in the modules of the channel (github.pb.js only declares routes of the app)', () => {
		for (const file of CHANNEL_FILES.filter((name) => name.startsWith('lib/'))) {
			expect(code(read(file)), file).not.toMatch(WRITING);
		}
	});

	it('leaves requests to GitHub to the client alone', () => {
		for (const file of ['github.pb.js', 'lib/github-service.js', 'lib/github-rules.js']) {
			expect(code(read(file)), file).not.toMatch(/\$http\b/);
		}
		const others = [
			...readdirSync(HOOKS).filter((name) => name.endsWith('.js')),
			...readdirSync(new URL('lib/', HOOKS)).map((name) => `lib/${name}`)
		].filter((file) => !CHANNEL_FILES.includes(file));
		for (const file of others) {
			expect(read(file), file).not.toContain('api.github.com');
		}
	});
});
