// Reading the open chat from hand-built pages (ADR-0038 §3): messages with text, sender, time and
// ID; media without text left out; the name of the chat; the state of the page.

import { beforeEach, describe, expect, it } from 'vitest';
import { chatTitle, messageElements, pageState, readMessage, textOf } from './extract';
import { showFixture } from './testing';

describe('a German group chat', () => {
	beforeEach(() => showFixture('chat-de.html'));

	it('finds the messages with text and reads them', () => {
		expect(chatTitle(document)).toBe('Familie Beispiel');
		const messages = messageElements(document).map((element) =>
			readMessage(element, chatTitle(document), 'de-DE')
		);
		expect(messages.map((message) => message?.id)).toEqual([
			'false_000000000@g.us_AAAA0000000000000001_000000001@c.us',
			'false_000000000@g.us_AAAA0000000000000003_000000002@c.us',
			'true_000000000@g.us_AAAA0000000000000004'
		]);
		expect(messages[0]).toMatchObject({
			text: 'Bitte Milch kaufen 🥛\nund Brot',
			sender: 'Anna Beispiel',
			chat: 'Familie Beispiel',
			time: new Date(2026, 8, 28, 14, 32).getTime(),
			outgoing: false
		});
		// A picture with a caption: the caption is the text.
		expect(messages[1]).toMatchObject({
			text: '#byl Rechnung Kindergarten',
			sender: 'Bert Muster'
		});
		// Own message; "Mehr anzeigen" is no text.
		expect(messages[2]).toMatchObject({ text: 'Mache ich morgen', sender: 'Du', outgoing: true });
	});

	it('leaves out a picture without text', () => {
		const media = document.querySelector('[data-id$="0002_000000002@c.us"]');
		expect(media).not.toBeNull();
		expect(messageElements(document)).not.toContain(media);
		expect(readMessage(media as Element, 'Familie Beispiel', 'de-DE')).toBeNull();
	});

	it('reads text without buttons and own elements', () => {
		const block = document.createElement('span');
		block.innerHTML =
			'Hallo<br>Welt <img alt="👍"><span role="button">Mehr anzeigen</span><span data-byl-wa>In den Eingang</span>';
		expect(textOf(block)).toBe('Hallo\nWelt 👍');
	});

	it('understands the page', () => {
		expect(pageState(document, 0)).toBe('ok');
	});
});

describe('the state of the page', () => {
	it('waits for the sign-in and while the page loads', () => {
		showFixture('sign-in.html');
		expect(pageState(document, 60_000)).toBe('waiting');
		document.body.innerHTML = '';
		expect(pageState(document, 5_000)).toBe('waiting');
		document.body.innerHTML = '<div id="app"><div class="loading"></div></div>';
		expect(pageState(document, 5_000)).toBe('waiting');
	});

	it('says "unknown" when the page looks different', () => {
		showFixture('chat-changed.html');
		expect(pageState(document, 0)).toBe('unknown');
		expect(messageElements(document)).toEqual([]);
		document.body.innerHTML = '<div id="app"><div class="new-layout"></div></div>';
		expect(pageState(document, 60_000)).toBe('unknown');
		document.body.innerHTML = '<div class="no-app"></div>';
		expect(pageState(document, 60_000)).toBe('unknown');
	});
});
