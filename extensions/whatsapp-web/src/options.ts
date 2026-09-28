// Entry of the settings page and popup (ADR-0038 §3); the logic is in options-core.ts.

import { startOptions } from './options-core';

void startOptions({
	document,
	local: chrome.storage.local,
	session: chrome.storage.session,
	send: (message) => chrome.runtime.sendMessage(message),
	now: () => Date.now()
});
