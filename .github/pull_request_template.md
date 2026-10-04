## Worum geht es?

<!-- Kurz: Was ändert sich und warum? Verweis auf Issue, Plan-Paket oder ADR. -->

## Checkliste

- [ ] Lokal grün nach CLAUDE.md §12: kleine Pakete die betroffenen Testdateien plus `check` und `lint` in `web`, größere `powershell -ExecutionPolicy Bypass -File scripts\build.ps1`; die volle Suite läuft in der CI
- [ ] Tests für neue oder geänderte Logik ergänzt
- [ ] `docs/test-manifest.html` aktualisiert (Eintrag in `pakete`, Testfälle, Status, Stand)
- [ ] Doku aktualisiert (README, Plan, ADR, CLAUDE.md), soweit betroffen
- [ ] Titel und Commits folgen Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`, `ci:`)
- [ ] Keine Secrets, keine Daten aus `app/pb_data` und keine Backups im Diff
