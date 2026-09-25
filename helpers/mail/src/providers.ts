// Mail providers (ADR-0016 section 4): host, port and TLS follow from the provider of a connection;
// the connection stores only its key. The keys mirror MAIL_PROVIDERS of
// app/pb_hooks/lib/connection-rules.js (providers.test.ts compares both).

import type { ImapEndpoint } from './config';

export interface MailProvider extends ImapEndpoint {
	label: string;
	/** Setup hint after a refused login, stored as hint of the connection. */
	loginHint: string;
}

export const PROVIDERS: Readonly<Record<string, MailProvider>> = Object.freeze({
	webde: {
		label: 'Web.de',
		host: 'imap.web.de',
		port: 993,
		secure: true,
		loginHint:
			'POP3/IMAP-Abruf in Web.de eingeschaltet (E-Mail-Einstellungen → POP3/IMAP → „POP3- und IMAP-Zugriff erlauben“)? Mit Zwei-Faktor-Anmeldung braucht es ein anwendungsspezifisches Passwort (Account verwalten → Login & Sicherheit). Web.de schaltet den Abruf nach längerer Nichtnutzung wieder aus.'
	}
});

export function providerOf(key: string): MailProvider | null {
	return Object.prototype.hasOwnProperty.call(PROVIDERS, key) ? (PROVIDERS[key] ?? null) : null;
}
