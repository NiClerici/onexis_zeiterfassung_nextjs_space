# syntax=docker/dockerfile:1
#
# Mehrstufiger Build für den Next.js Standalone-Output (MIGRATION.md
# Punkt 11). Drei Stufen: deps (nur Abhängigkeiten, bester Cache-Layer),
# builder (Prisma-Client + Next-Build), runner (schlankes Laufzeit-Image,
# non-root).

# ---- deps ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# --legacy-peer-deps: bestehender Peer-Dependency-Konflikt zwischen
# eslint-config-next und dem gepinnten @typescript-eslint/parser (siehe
# MIGRATION.md Punkt 2, Ergebnis) — betrifft nur devDependencies, aber
# ohne das Flag bricht schon npm ci selbst ab.
RUN npm ci --legacy-peer-deps

# ---- builder ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
# Aktiviert den Next.js Standalone-Output (next.config.js liest
# NEXT_OUTPUT_MODE über process.env.NEXT_OUTPUT_MODE als output-Modus).
ENV NEXT_OUTPUT_MODE=standalone
# Für den Build selbst wird keine echte Datenbank kontaktiert (Next.js
# rendert alle Routen dieser App dynamisch, siehe "force-dynamic" in den
# Layouts) — ein Platzhalter genügt, damit Prisma beim Client-Generieren
# nicht wegen eines fehlenden DATABASE_URL abbricht.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"

# npx prisma generate ist Pflicht vor jedem Build/Typecheck in diesem
# Projekt (siehe MIGRATION.md Regel 3) — ohne das schlägt "next build"
# mit falschen Prisma-Typen fehl.
RUN npx prisma generate
RUN npm run build

# next.config.js setzt experimental.outputFileTracingRoot bewusst auf das
# ELTERNVERZEICHNIS des Projekts (Erbe des ursprünglichen Monorepo-
# Scaffolds der Hosting-Plattform, siehe MIGRATION.md Punkt 10, Notizen).
# Dadurch landet der Standalone-Output nicht direkt unter
# .next/standalone/server.js wie in den meisten Next.js-Docker-Anleitungen,
# sondern eine Ebene tiefer unter einem Ordner, dessen Name vom WORKDIR
# abhängt (hier: "app"). Statt diesen Pfad hart zu verdrahten (fragil bei
# jeder künftigen next.config.js- oder WORKDIR-Änderung), wird server.js
# dynamisch gesucht (unter Ausschluss verschachtelter server.js-Dateien
# aus node_modules, z.B. aus next/dist selbst) und der eigentliche
# Standalone-Baum an eine feste Stelle "geflacht".
RUN set -e && \
    SERVER_DIR=$(dirname "$(find /app/.next/standalone -maxdepth 4 -name server.js -not -path '*/node_modules/*' | head -1)") && \
    mkdir -p /app/standalone-flat && \
    cp -a "$SERVER_DIR"/. /app/standalone-flat/

# ---- runner ----
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# curl für den Docker-HEALTHCHECK gegen /api/health (siehe unten).
RUN apk add --no-cache curl

# Non-root — kein Prozess dieser App braucht Root-Rechte im Container.
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/standalone-flat ./
# .next/static und public/ sind bewusst NICHT Teil des Standalone-Outputs
# (dokumentiertes Next.js-Verhalten) und müssen separat kopiert werden.
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
