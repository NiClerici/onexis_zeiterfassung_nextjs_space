---
description: Arbeitet das Infomaniak-VPS-Deployment Schritt für Schritt ab, verifiziert jeden Schritt und wiederholt bei Fehlern
argument-hint: [optional: Schrittnummer zum Wiedereinstieg]
allowed-tools: Bash, Read, Write, Edit
---

# Deployment-Loop: ONEXIS Zeiterfassung auf Infomaniak VPS Lite

Du fuehrst das Deployment dieser App auf einen Infomaniak VPS Lite durch
(2 vCPU / 4 GB / 60 GB, Schweizer Rechenzentrum). Ziel:
`https://$DOMAIN/api/health` liefert `{"status":"ok","database":"ok"}`
ueber gueltiges TLS.

Vorgeschichte: der urspruengliche Loop zielte auf eine Oracle-Cloud-
Always-Free-VM. Dort war `VM.Standard.A1.Flex` in Zuerich dauerhaft
"out of capacity" (Ein-AD-Region, kein Ausweichen moeglich, Always Free
gilt nur in der Home-Region). Deshalb der Wechsel auf einen bezahlten,
aber verfuegbaren Schweizer VPS.

## Zustand

Fuehre `DEPLOY_STATE.md` im Repo-Root (gitignored). Struktur:

```markdown
# Deploy-State
- SSH_TARGET: <user@ip oder ssh-alias, leer wenn unbekannt>
- DOMAIN: <z.B. onexis-zeit.duckdns.org>
- Aktueller Schritt: <n>

## Schritte
- [x] 1 Konto & VPS bestellt — 2026-08-18 verifiziert
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
2. Sonst: Befehl per SSH auf dem VPS ausfuehren.
3. **Verify-Befehl** ausfuehren. Nur bei Erfolg abhaken.
4. Bei Fehler: Ursache aus stderr/Logs bestimmen, gezielt fixen, erneut.
   **Maximal 3 Versuche pro Schritt**, danach stoppen und melden — nicht
   weiterwursteln, nicht auf den naechsten Schritt springen.
5. Nach jedem Schritt `DEPLOY_STATE.md` aktualisieren.

Abbruch der Schleife, wenn Schritt 9 verifiziert ist. Dann Kurzreport:
URL, was noch offen ist (SMTP, Backups, FOLLOWUP-Bugs).

## Schritte

**1 MANUELL — Konto & VPS bestellen.** `infomaniak.com` → *VPS Lite*,
Tarif **2 vCPU / 4 GB RAM / 60 GB** (CHF 7.20/Monat). Betriebssystem
**Ubuntu 22.04 LTS**. Beim Bestellen den vorhandenen Public Key
hinterlegen:
```bash
cat ~/.ssh/oracle_zeiterfassung.pub
```
(Der Dateiname stammt aus dem Oracle-Versuch — der Schluessel selbst ist
unveraendert brauchbar, ein neuer braechte keinen Sicherheitsgewinn.)

**2 MANUELL — Zugang notieren.** Aus der Bestellbestaetigung bzw. dem
Infomaniak-Manager die **Public IPv4** und den **Benutzernamen** holen
(je nach Image `ubuntu`, `debian` oder ein eigener). `SSH_TARGET` im
State eintragen.
Verify: `ssh -i ~/.ssh/oracle_zeiterfassung $SSH_TARGET 'uname -m'` →
**`x86_64`**.
Bei `Permission denied`: pruefen, ob der Key bei der Bestellung wirklich
hinterlegt wurde; Infomaniak laesst ihn im Manager nachtragen, danach
VPS neu starten.

**3 — Firewall pruefen.** Anders als bei Oracle filtert das Image hier
nichts vor: kein iptables-Hack noetig, nur nachsehen.
```bash
sudo ufw status
sudo iptables -L INPUT -n --line-numbers
```
Verify: `ufw` ist `inactive` (oder erlaubt 22/80/443) und die
INPUT-Kette enthaelt **kein** pauschales `REJECT`/`DROP`. Nur wenn doch
etwas blockt, gezielt oeffnen — nicht praeventiv Regeln anlegen.
Zusaetzlich im Infomaniak-Manager pruefen, ob dort eine Firewall aktiv
ist, die 80/443 zuhaelt (Produktseite nennt "Firewall und DDoS-Schutz").

**4 — Docker.**
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```
`curl` und `git` sind auf dem Server-Image nicht garantiert vorhanden,
werden aber in Schritt 4 und 6 gebraucht.
Verify: `ssh $SSH_TARGET 'docker compose version && git --version'`
(neue SSH-Session noetig, damit die Docker-Gruppe greift).

**5 MANUELL — DuckDNS.** Subdomain anlegen, VPS-IP eintragen, `DOMAIN`
im State setzen.
Verify: `dig +short $DOMAIN` == Public IP des VPS. Erst weiter, wenn das
stimmt — sonst scheitert die Let's-Encrypt-Challenge und Caddy laeuft in
ein Rate-Limit.

**6 — Repo & .env.** Das Repo ist oeffentlich, der Klon braucht kein
Token. Vorher pruefen, dass `origin/main` den `migrate`-Service in
`docker-compose.yml` enthaelt (`git ls-remote origin main` gegen den
lokalen HEAD) — der VPS zieht von GitHub, nur lokal committete Fixes
kommen dort nicht an.
```bash
git clone https://github.com/NiClerici/onexis_zeiterfassung_nextjs_space.git zeiterfassung
cd zeiterfassung && cp .env.example .env
```
Secrets **auf dem VPS** erzeugen und direkt in die Datei schreiben, nie
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

**7 — Swap, Build & Start.** 4 GB RAM sind fuer `npm ci` plus
`next build` knapp; ein OOM-Kill mitten im Build ist die
wahrscheinlichste Stoerung dieses Loops. Deshalb einmalig vorher:
```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```
Verify Swap: `free -h` zeigt 2 GB.

Der Build dauert laenger als das Zeitlimit eines einzelnen Bash-Aufrufs,
also entkoppelt starten und pollen, nicht blockierend warten:
```bash
nohup docker compose up -d --build > /tmp/build.log 2>&1 &
# pollen bis fertig:
tail -20 /tmp/build.log ; docker compose ps
docker compose run --rm --build migrate
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
Port 80 zu (→ Schritt 3 neu pruefen, inklusive Firewall im
Infomaniak-Manager). Nicht wiederholt `up -d` feuern, das behebt nichts
und triggert LE-Rate-Limits.

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
- Secrets nur auf dem VPS erzeugen (`openssl rand`), nie in der Chat-
  Ausgabe oder in `DEPLOY_STATE.md`.
- Keine Schritte ueberspringen, keinen Schritt ohne bestandenen
  Verify-Befehl abhaken. Wenn du unsicher bist, ob ein Verify wirklich
  gruen war: als rot behandeln.
- Manuelle Schritte nie selbst "annehmen" — immer auf Nicos Bestaetigung
  warten.
- Aenderungen am Repo-Code sind waehrend des Loops tabu. Wenn ein Bug
  das Deployment blockiert: stoppen, Befund melden, nicht heimlich
  patchen.
