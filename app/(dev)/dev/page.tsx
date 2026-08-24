// Developer-Übersicht (/dev) — read-only Plattformsicht über alle
// Organisationen ("Kunden" im SaaS-Sinn, nicht zu verwechseln mit dem
// fachlichen Customer-Modell). Server Component: ruft lib/dev-metrics.ts
// direkt auf, keine /api/dev/*-Routen — einziger Konsument, kein
// client-fetch-Overhead nötig.

import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { AccessError } from "@/lib/access";
import { requireDeveloper } from "@/lib/dev-access";
import {
  getPlatformSummary,
  getOrgOverview,
  getSystemHealth,
  getAuthHealth,
  getEnvStatus,
  getBackupStatus,
  BACKUP_STALE_HOURS,
  type OrgOverviewRow,
} from "@/lib/dev-metrics";
import { PLAN_LIMITS } from "@/lib/billing-rules";
import { PageHeader } from "@/components/layouts/page-header";
import { StatTile } from "@/components/dev/stat-tile";
import { StatusDot } from "@/components/dev/status-dot";
import { WeeklyBars } from "@/components/dev/weekly-bars";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { cn } from "@/lib/utils";

async function requireAccess() {
  try {
    return await requireDeveloper();
  } catch (error) {
    if (error instanceof AccessError && error.status === 401) redirect("/login?callbackUrl=/dev");
    notFound();
  }
}

function formatDate(d: Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

function formatDateTime(d: Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("de-CH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
}

function daysUntil(d: Date | null): number | null {
  if (!d) return null;
  return Math.ceil((d.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

function formatAge(hours: number | null): string {
  if (hours === null) return "—";
  if (hours < 1) return "< 1 h";
  if (hours < 48) return `vor ${Math.round(hours)} h`;
  return `vor ${Math.round(hours / 24)} Tagen`;
}

function activityBadge(status: OrgOverviewRow["activityStatus"]) {
  const variant = status === "aktiv" ? "default" : status === "schläfrig" ? "outline" : "secondary";
  return <Badge variant={variant as any}>{status}</Badge>;
}

export default async function DevPage() {
  await requireAccess();

  const [platform, orgOverview, systemHealth, authHealth, env, backup] = await Promise.all([
    getPlatformSummary(),
    getOrgOverview(),
    getSystemHealth(),
    getAuthHealth(),
    Promise.resolve(getEnvStatus()),
    getBackupStatus(),
  ]);
  const backupStale = backup.status === "ok" && backup.ageHours !== null && backup.ageHours > BACKUP_STALE_HOURS;
  const backupTone = backup.status === "failed" ? "danger" : backup.status === "missing" || backupStale ? "warning" : "success";

  return (
    <div className="space-y-10">
      <PageHeader title="Developer-Übersicht" description="Read-only Plattformsicht über alle Organisationen — keine Aktion hier ändert Kundendaten." />

      {/* Statusleiste */}
      <section className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <div className="rounded-lg border bg-card p-3 flex items-center gap-2">
          <StatusDot tone={systemHealth.databaseOk ? "success" : "danger"} />
          <div className="text-xs">
            <div className="font-medium">Datenbank</div>
            <div className="text-muted-foreground">{systemHealth.databaseOk ? "erreichbar" : "nicht erreichbar"}</div>
          </div>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <div className="text-xs font-medium">DB-Grösse</div>
          <div className="text-xs text-muted-foreground font-mono">{formatBytes(systemHealth.databaseSizeBytes)}</div>
        </div>
        <div className="rounded-lg border bg-card p-3 flex items-center gap-2">
          <StatusDot tone={systemHealth.pendingMigration ? "warning" : "success"} />
          <div className="text-xs">
            <div className="font-medium">Migrationen</div>
            <div className="text-muted-foreground font-mono">{systemHealth.migrationsCount} · {systemHealth.pendingMigration ? "hängend" : "vollständig"}</div>
          </div>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <div className="text-xs font-medium">Node-Umgebung</div>
          <div className="text-xs text-muted-foreground font-mono">{env.nodeEnv}</div>
        </div>
        <div className="rounded-lg border bg-card p-3 flex items-center gap-2">
          <StatusDot tone={env.smtpConfigured ? "success" : "warning"} />
          <div className="text-xs">
            <div className="font-medium">SMTP</div>
            <div className="text-muted-foreground">{env.smtpConfigured ? "konfiguriert" : "nicht konfiguriert"}</div>
          </div>
        </div>
        <div className="rounded-lg border bg-card p-3 flex items-center gap-2">
          <StatusDot tone={backupTone} />
          <div className="text-xs">
            <div className="font-medium">Backup</div>
            <div className="text-muted-foreground">
              {backup.status === "missing"
                ? "noch kein Lauf protokolliert"
                : backup.status === "failed"
                ? `fehlgeschlagen · ${formatAge(backup.ageHours)}`
                : `${formatAge(backup.ageHours)}${backupStale ? " · überfällig" : ""}`}
            </div>
          </div>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <div className="text-xs font-medium">Version</div>
          <div className="text-xs text-muted-foreground font-mono">{env.appVersion ?? "unbekannt"}</div>
        </div>
      </section>

      {/* Business */}
      <section>
        <h2 className="font-display text-lg font-semibold tracking-tight mb-3">Business</h2>
        {platform.error ? (
          <p className="text-sm text-destructive">{platform.error}</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <StatTile label="Organisationen" value={platform.orgsTotal} />
              <StatTile label="trial" value={platform.orgsByPlan.trial} hint={`Limit ${PLAN_LIMITS.trial.maxUsers ?? "∞"} Sitze`} />
              <StatTile label="starter" value={platform.orgsByPlan.starter} hint={`Limit ${PLAN_LIMITS.starter.maxUsers ?? "∞"} Sitze`} />
              <StatTile label="pro" value={platform.orgsByPlan.pro} hint={`Limit ${PLAN_LIMITS.pro.maxUsers ?? "∞"} Sitze`} />
              <StatTile label="Nutzer gesamt" value={platform.usersTotal} />
              <StatTile
                label="Trials ≤7 Tage / abgelaufen"
                value={`${platform.trialsExpiringSoon} / ${platform.trialsExpired}`}
                tone={platform.trialsExpired > 0 ? "danger" : platform.trialsExpiringSoon > 0 ? "warning" : "default"}
              />
            </div>
            <div className="mt-4 rounded-lg border bg-card p-4">
              <div className="text-xs font-medium text-muted-foreground mb-2">Signups je Woche (letzte 12 Wochen)</div>
              <WeeklyBars data={platform.signupsPerWeek} />
            </div>
          </>
        )}
      </section>

      {/* Kunden-Tabelle */}
      <section>
        <h2 className="font-display text-lg font-semibold tracking-tight mb-3">Organisationen</h2>
        {orgOverview.error ? (
          <p className="text-sm text-destructive">{orgOverview.error}</p>
        ) : orgOverview.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keine Organisationen vorhanden.</p>
        ) : (
          <div className="rounded-lg border bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organisation</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Trial</TableHead>
                  <TableHead>Sitze</TableHead>
                  <TableHead>Letzte Aktivität</TableHead>
                  <TableHead>Einträge 30d</TableHead>
                  <TableHead>Aktive Nutzer 30d</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orgOverview.rows.map((row) => {
                  const seatsOver = row.maxUsers !== null && row.seatsActive > row.maxUsers;
                  const trialDays = row.plan === "trial" ? daysUntil(row.trialEndsAt) : null;
                  return (
                    <TableRow key={row.id}>
                      <TableCell>
                        <Link href={`/dev/orgs/${row.slug}`} className="font-medium hover:text-primary transition">
                          {row.name}
                        </Link>
                        <div className="text-xs text-muted-foreground font-mono">{row.slug}</div>
                      </TableCell>
                      <TableCell><Badge variant="outline">{row.plan}</Badge></TableCell>
                      <TableCell className="text-xs">
                        {trialDays === null ? "—" : trialDays < 0 ? <span className="text-destructive">abgelaufen</span> : `${trialDays} Tage`}
                      </TableCell>
                      <TableCell className={cn("font-mono", seatsOver && "text-destructive")}>
                        {row.seatsActive}
                        {row.maxUsers !== null ? `/${row.maxUsers}` : ""}
                        {row.seatsInactive > 0 && <span className="text-muted-foreground"> (+{row.seatsInactive} inaktiv)</span>}
                      </TableCell>
                      <TableCell className="text-xs">{formatDate(row.lastActivity)}</TableCell>
                      <TableCell className="font-mono">{row.entries30d}</TableCell>
                      <TableCell className="font-mono">{row.activeUsers30d}</TableCell>
                      <TableCell>{activityBadge(row.activityStatus)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* Auth & Integrität */}
      <section>
        <h2 className="font-display text-lg font-semibold tracking-tight mb-3">Auth &amp; Integrität</h2>
        {authHealth.error ? (
          <p className="text-sm text-destructive">{authHealth.error}</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <StatTile label="Fehlgeschlagene Logins 24h" value={authHealth.failedLogins24h} />
              <StatTile label="Fehlgeschlagene Logins 7d" value={authHealth.failedLogins7d} />
              <StatTile label="Aktuell gesperrte Buckets" value={authHealth.lockedBuckets.length} tone={authHealth.lockedBuckets.length > 0 ? "warning" : "default"} />
              <StatTile label="Offene Einladungen" value={authHealth.openInvitations} />
              <StatTile
                label="mustSetPassword"
                value={authHealth.usersMustSetPassword}
                hint={!env.smtpConfigured && authHealth.usersMustSetPassword > 0 ? "ohne SMTP: Passwort-Reset nur per Link/SSH" : undefined}
                tone={!env.smtpConfigured && authHealth.usersMustSetPassword > 0 ? "warning" : "default"}
              />
            </div>
            {authHealth.lockedBuckets.length > 0 && (
              <div className="mt-3 rounded-lg border bg-card p-4">
                <div className="text-xs font-medium text-muted-foreground mb-2">Gesperrte Buckets (Login-Rate-Limit)</div>
                <ul className="text-xs font-mono space-y-1">
                  {authHealth.lockedBuckets.map((b) => (
                    <li key={`${b.bucket}-${b.value}`}>
                      {b.bucket === "email" ? "E-Mail" : "IP"}: {b.value} — {b.attempts} Fehlversuche
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </section>

      {/* Tabellen & Zeilen */}
      <section>
        <h2 className="font-display text-lg font-semibold tracking-tight mb-3">Tabellen &amp; Zeilen</h2>
        {systemHealth.error ? (
          <p className="text-sm text-destructive">{systemHealth.error}</p>
        ) : (
          <div className="rounded-lg border bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tabelle</TableHead>
                  <TableHead>Zeilen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {systemHealth.tableRowCounts.map((t) => (
                  <TableRow key={t.table}>
                    <TableCell className="font-mono text-xs">{t.table}</TableCell>
                    <TableCell className="font-mono">{t.rows.toLocaleString("de-CH")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {systemHealth.lastMigration && (
          <p className="mt-2 text-xs text-muted-foreground">
            Letzte Migration: <span className="font-mono">{systemHealth.lastMigration.name}</span> — {formatDateTime(systemHealth.lastMigration.finishedAt)}
          </p>
        )}
      </section>
    </div>
  );
}
