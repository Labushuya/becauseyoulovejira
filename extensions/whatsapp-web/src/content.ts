// Entry of the content script on https://web.whatsapp.com/ (ADR-0038 §3); the logic is in
// content-core.ts.

import { startContent } from './content-core';

startContent({
	document,
	storage: chrome.storage.local,
	onStorageChanged: (listener) => chrome.storage.onChanged.addListener(listener),
	send: (message) => chrome.runtime.sendMessage(message),
	locale: navigator.language,
	now: () => Date.now()
});
