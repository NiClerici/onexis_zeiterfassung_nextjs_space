---
description: Arbeitet das Oracle-Free-Deployment Schritt für Schritt ab, verifiziert jeden Schritt und wiederholt bei Fehlern
argument-hint: [optional: Schrittnummer zum Wiedereinstieg]
allowed-tools: Bash, Read, Write, Edit
---

# Deployment-Loop: ONEXIS Zeiterfassung auf Oracle Cloud Always Free

Du fuehrst das Deployment dieser App auf eine Oracle-Cloud-Always-Free-VM
durch. Ziel: `https://$DOMAIN/api/health` liefert
`{"status":"ok","database":"ok"}` ueber gueltiges TLS.

## Zustand

Fuehre `DEPLOY_STATE.md` im Repo-Root (gitignored). Struktur:

```markdown
# Deploy-State
- SSH_TARGET: <user@ip oder ssh-alias, leer wenn unbekannt>
- DOMAIN: <z.B. onexis-zeit.duckdns.org>
- Aktueller Schritt: <n>

## Schritte
- [x] 1 Account & Home-Region Zuerich — 2026-08-17 verifiziert
- [ ] 2 ...

## Log
<pro Versuch: Schritt, Befehl, Ergebnis, Fehlerursache, Fix>
```

Beim Start: Datei lesen falls vorhanden, sonst anlegen. Mit Argument
`$ARGUMENTS` bei dieser Schrittnummer einsteigen, sonst beim ersten
offenen Schritt.

## Schleife

Pro Schritt:

1. Ist es ein **MANUELL**-Schritt? → Anweisung ausgeben, stoppen, auf
   Bestaetigung warten. Nichts vortaeuschen, nichts abhaken ohne Verify.
2. Sonst: Befehl per SSH auf der VM ausfuehren.
3. **Verify-Befehl** ausfuehren. Nur bei Erfolg abhaken.
4. Bei Fehler: Ursache aus stderr/Logs bestimmen, gezielt fixen, erneut.
   **Maximal 3 Versuche pro Schritt**, danach stoppen und melden — nicht
   weiterwursteln, nicht auf den naechsten Schritt springen.
5. Nach jedem Schritt `DEPLOY_STATE.md` aktualisieren.

Abbruch der Schleife, wenn Schritt 9 verifiziert ist. Dann Kurzreport:
URL, was noch offen ist (SMTP, Backups, FOLLOWUP-Bugs).

## Schritte

**1 MANUELL — Account & Region.** `cloud.oracle.com/free`, Home-Region
*Switzerland North (Zurich)*, nicht aenderbar. Budget-Alert auf 1 CHF.

**2 MANUELL — VM.** Ubuntu 22.04 aarch64, `VM.Standard.A1.Flex`,
2 OCPU / 12 GB, 50 GB Boot, SSH-Key, Public IPv4.
Bei "Out of capacity": andere Availability Domain, sonst spaeter erneut.
Danach `SSH_TARGET` im State eintragen.
Verify: `ssh $SSH_TARGET 'uname -m'` → `aarch64`

**3a MANUELL — Security List.** VCN → Security Lists → Default →
Ingress `0.0.0.0/0` TCP 80 und 443.

**3b — iptables auf der VM.** Oracle-Images verwerfen alles ausser SSH.
```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```
Verify: `sudo iptables -L INPUT -n --line-numbers` — beide ACCEPT muessen
VOR dem `REJECT all` stehen. Wenn nicht: Regelnummer anpassen, nicht
blind wiederholen (sonst Duplikate).

**4 — Docker.**
```bash
sudo apt update && sudo apt upgrade -y
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```
Verify: `ssh $SSH_TARGET 'docker compose version'` (neue SSH-Session
noetig, damit die Gruppe greift).

**5 MANUELL — DuckDNS.** Subdomain anlegen, VM-IP eintragen, `DOMAIN`
im State setzen.
Verify: `dig +short $DOMAIN` == Public IP der VM. Erst weiter, wenn das
stimmt — sonst scheitert die Let's-Encrypt-Challenge und Caddy laeuft in
ein Rate-Limit.

**6 — Repo & .env.** Das Repo ist oeffentlich, der Klon braucht kein
Token. Vorher pruefen, dass `origin/main` den `migrate`-Service in
`docker-compose.yml` enthaelt (`git ls-remote origin main` gegen den
lokalen HEAD) — die VM zieht von GitHub, nur lokal committete Fixes
kommen dort nicht an.
```bash
git clone https://github.com/NiClerici/onexis_zeiterfassung_nextjs_space.git zeiterfassung
cd zeiterfassung && cp .env.example .env
```
Secrets **auf der VM** erzeugen und direkt in die Datei schreiben, nie
ueber die Console ausgeben:
```bash
sed -i "s|^NEXTAUTH_SECRET=.*|NEXTAUTH_SECRET=\"$(openssl rand -base64 32)\"|" .env
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=\"$(openssl rand -base64 24)\"|" .env
sed -i "s|^NEXTAUTH_URL=.*|NEXTAUTH_URL=\"https://$DOMAIN\"|" .env
sed -i "s|^DOMAIN=.*|DOMAIN=\"$DOMAIN\"|" .env
```
Verify: `grep -c '^NEXTAUTH_SECRET="[^"]\{40,\}"' .env` → 1
(`DATABASE_URL` in der .env bleibt ignoriert — Compose baut sie aus den
`POSTGRES_*` gegen den `db`-Service neu zusammen.)

**7 — Build & Start.** Der Build dauert auf 2 ARM-Kernen 8-12 Minuten und
sprengt damit das Zeitlimit eines einzelnen Bash-Aufrufs. Deshalb auf der
VM entkoppelt starten und pollen, nicht blockierend warten:
```bash
nohup docker compose up -d --build > /tmp/build.log 2>&1 &
# pollen bis fertig:
tail -20 /tmp/build.log ; docker compose ps
docker compose run --rm migrate
```
`migrate` ist ein Einmal-Container gegen die `builder`-Stage (siehe
`docker-compose.yml`). **Nicht** `docker compose exec app npx prisma
migrate deploy` verwenden — das Laufzeit-Image enthaelt weder das
prisma-CLI noch `prisma/schema.prisma`.
Verify: `docker compose ps` → `db` healthy, `app` healthy, `caddy` Up
(`migrate` erscheint dort nicht, laeuft mit `--rm`).

**8 — TLS & Healthcheck.**
Verify: `curl -f https://$DOMAIN/api/health` → `"status":"ok"`.
Bei Fehler zuerst `docker compose logs --tail=50 caddy` lesen. Typisch:
DNS noch nicht propagiert (→ warten, Schritt 5 neu verifizieren) oder
Port 80 zu (→ Schritt 3a/3b neu pruefen). Nicht wiederholt `up -d`
feuern, das behebt nichts und triggert LE-Rate-Limits.

**9 MANUELL — Erste Nutzer.** `/register` im Browser, echte Organisation
anlegen, Kollegen per Invite dazuholen.

## Harte Regeln

- **Kein** `prisma db seed` / `scripts/seed.ts` auf dieser Instanz —
  legt Demo-Accounts mit fest codierten Passwoertern auf einer
  oeffentlich erreichbaren Instanz an.
- **Kein** `prisma migrate reset`, **kein** `docker compose down -v` —
  beides loescht die Datenbank. Wenn du glaubst, du brauchst das:
  stoppen und fragen.
- `.env` niemals committen, niemals ausgeben, niemals in den Report.
- Secrets nur auf der VM erzeugen (`openssl rand`), nie in der Chat-
  Ausgabe oder in `DEPLOY_STATE.md`.
- Keine Schritte ueberspringen, keinen Schritt ohne bestandenen
  Verify-Befehl abhaken. Wenn du unsicher bist, ob ein Verify wirklich
  gruen war: als rot behandeln.
- Manuelle Schritte nie selbst "annehmen" — immer auf Nicos Bestaetigung
  warten.
- Aenderungen am Repo-Code sind waehrend des Loops tabu. Wenn ein Bug
  das Deployment blockiert: stoppen, Befund melden, nicht heimlich
  patchen.
