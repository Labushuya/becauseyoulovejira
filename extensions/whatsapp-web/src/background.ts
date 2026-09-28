// Service worker of the extension (ADR-0038 §3): wires handleMessage to the runtime and opens the
// settings after the installation, where address and key are entered.

import { handleMessage } from './background-core';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	void handleMessage(message, sender, {
		local: chrome.storage.local,
		session: chrome.storage.session,
		fetch: (input, init) => fetch(input, init),
		extensionId: chrome.runtime.id,
		now: () => Date.now()
	}).then(sendResponse, () => sendResponse(null));
	// The answer comes asynchronously.
	return true;
});

chrome.runtime.onInstalled.addListener((details) => {
	if (details.reason === 'install') void chrome.runtime.openOptionsPage();
});
