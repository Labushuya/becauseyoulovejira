// Read-only access with imapflow against the fake IMAP server (ADR-0016 section 5; E4 plan package
// 11): EXAMINE instead of SELECT, BODY.PEEK, no command that changes the mailbox, flags untouched.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeImapServer, fakeMail } from '../test/fake-imap';
import { isAuthenticationFailure, openInbox, type InboxSession } from './imap';

let server: FakeImapServer;
let session: InboxSession | null = null;

const endpoint = () => ({ host: '127.0.0.1', port: server.port, secure: false });
const credentials = () => ({ user: server.user, pass: server.password });

beforeEach(async () => {
	server = new FakeImapServer();
	await server.start();
});

afterEach(async () => {
	await session?.close();
	session = null;
	await server.stop();
});

describe('openInbox', () => {
	it('opens the inbox with EXAMINE and knows UIDVALIDITY and the highest UID', async () => {
		server.add(fakeMail({ subject: 'Eins', messageId: '<1@x>' }));
		server.add(fakeMail({ subject: 'Zwei', messageId: '<2@x>' }));
		session = await openInbox(endpoint(), credentials());
		expect(session.uidValidity).toBe('1700000000');
		expect(session.highestUid).toBe(2);
		expect(server.commands.map((command) => command.name)).toContain('EXAMINE');
		expect(server.commands.map((command) => command.name)).not.toContain('SELECT');
	});

	it('lists mails after a UID and reads their source with BODY.PEEK only', async () => {
		for (let i = 1; i <= 5; i++) server.add(fakeMail({ subject: `Mail ${i}`, messageId: `<${i}@x>` }));
		session = await openInbox(endpoint(), credentials());
		const listed = await session.listAfter(2, 2);
		expect(listed.map((mail) => mail.uid)).toEqual([3, 4]);
		expect(listed[0]?.size).toBe(server.mails[2]?.source.length);
		expect(await session.listAfter(5, 10)).toEqual([]);
		const source = await session.source(3);
		expect(Buffer.from(source ?? []).toString('utf8')).toContain('Subject: Mail 3');
		expect(await session.source(99)).toBeNull();
		await session.close();
		session = null;
		expect(server.writes()).toEqual([]);
		expect(server.flagsUnchanged()).toBe(true);
		expect(server.commands.filter((command) => /FETCH/.test(command.name)).map((c) => c.args).join(' ')).toMatch(
			/BODY\.PEEK\[\]/
		);
	});

	it('handles an empty inbox', async () => {
		session = await openInbox(endpoint(), credentials());
		expect(session.highestUid).toBe(0);
		expect(await session.listAfter(0, 10)).toEqual([]);
	});

	it('reports a refused login as such, without the password', async () => {
		server.refuseLogin = true;
		const error = await openInbox(endpoint(), credentials()).catch((reason: unknown) => reason);
		expect(isAuthenticationFailure(error)).toBe(true);
		expect(String((error as Error).message)).not.toContain(server.password);
		expect(server.commands.find((command) => command.name === 'LOGIN')?.args).toBe('***');
	});

	it('refuses a server that opens the inbox writable', async () => {
		server.writableExamine = true;
		await expect(openInbox(endpoint(), credentials())).rejects.toThrow(/nur lesend/);
	});

	it('fails with a network error when nothing listens', async () => {
		const port = server.port;
		await server.stop();
		const error = await openInbox({ host: '127.0.0.1', port, secure: false }, credentials()).catch(
			(reason: unknown) => reason
		);
		expect(error).toBeInstanceOf(Error);
		expect(isAuthenticationFailure(error)).toBe(false);
		await server.start();
	});
});
