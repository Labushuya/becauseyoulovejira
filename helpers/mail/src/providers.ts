// Mail providers (ADR-0016 section 4; E4 plan packages 11 and 13): host, port and TLS follow from the provider of a connection;
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
	},
	// IMAP is always on for Gmail (since January 2025); a private account signs in with an app
	// password, which needs 2-Step Verification. The normal account password is refused.
	gmail: {
		label: 'Gmail',
		host: 'imap.gmail.com',
		port: 993,
		secure: true,
		loginHint:
			'App-Passwort nötig (Bestätigung in zwei Schritten): Gmail nimmt das normale Kontopasswort nicht an. Unter myaccount.google.com → Sicherheit die Bestätigung in zwei Schritten einschalten, dann unter myaccount.google.com/apppasswords ein App-Passwort anlegen und per setx in die Variable der Verbindung schreiben (danach stop.bat und start.bat). Mit „Erweitertem Schutz“ gibt es keine App-Passwörter; dann bleibt der Weg über .eml-Dateien.'
	}
});

export function providerOf(key: string): MailProvider | null {
	return Object.prototype.hasOwnProperty.call(PROVIDERS, key) ? (PROVIDERS[key] ?? null) : null;
}
