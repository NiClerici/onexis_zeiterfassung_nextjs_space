// Drilldown je Organisation — read-only, verlinkt von der Kunden-Tabelle in
// app/(dev)/dev/page.tsx. Eigene, gezielte Query (lib/dev-metrics.ts
// getOrgDetail) statt die Übersichtszeile zu filtern: hier werden Felder
// gebraucht, die die Tabellenübersicht bewusst nicht lädt (Mitgliederliste,
// ArG-Toggles, Monatsnutzung).

import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { AccessError } from "@/lib/access";
import { requireDeveloper } from "@/lib/dev-access";
import { getOrgDetail } from "@/lib/dev-metrics";
import { PageHeader } from "@/components/layouts/page-header";
import { StatTile } from "@/components/dev/stat-tile";
import { OrgPlanActions } from "@/components/dev/org-plan-actions";
import { ResetLinkButton } from "@/components/dev/reset-link-button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

async function requireAccess() {
  try {
    return await requireDeveloper();
  } catch (error) {
    if (error instanceof AccessError && error.status === 401) redirect(`/login?callbackUrl=/dev`);
    notFound();
  }
}

function formatDate(d: Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

export default async function DevOrgDetailPage({ params }: { params: { slug: string } }) {
  await requireAccess();

  const org = await getOrgDetail(params.slug);
  if (!org) notFound();

  return (
    <div className="space-y-10">
      <div>
        <Link href="/dev" className="text-sm text-muted-foreground hover:text-foreground transition">
          ← Alle Organisationen
        </Link>
      </div>
      <PageHeader
        title={org.name}
        description={`${org.slug} · erstellt am ${formatDate(org.createdAt)}`}
        actions={<OrgPlanActions slug={org.slug} currentPlan={org.plan} isTrial={org.plan === "trial"} />}
      />

      <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatTile label="Trial bis" value={formatDate(org.trialEndsAt)} />
        <StatTile label="Max. Wochenstunden" value={org.maxWeeklyHours} />
        <StatTile label="Mitglieder" value={org.members.length} />
        <StatTile label="Kunden / Projekte" value={`${org.customerCount} / ${org.projectCount}`} />
        <StatTile label="Monatsabschlüsse" value={org.monthLocksCount} />
        <StatTile label="Offene Absenzanträge" value={org.openAbsenceRequests} tone={org.openAbsenceRequests > 0 ? "warning" : "default"} />
      </section>

      <section>
        <h2 className="font-display text-lg font-semibold tracking-tight mb-3">ArG-Warnungen</h2>
        <div className="flex gap-3">
          <Badge variant={org.warnPauseZuKurz ? "default" : "outline"}>Pause zu kurz: {org.warnPauseZuKurz ? "an" : "aus"}</Badge>
          <Badge variant={org.warnSonntagsarbeit ? "default" : "outline"}>Sonntagsarbeit: {org.warnSonntagsarbeit ? "an" : "aus"}</Badge>
        </div>
      </section>

      <section>
        <h2 className="font-display text-lg font-semibold tracking-tight mb-3">Mitglieder</h2>
        <div className="rounded-lg border bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>E-Mail</TableHead>
                <TableHead>Rolle</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Eintritt</TableHead>
                <TableHead>Austritt</TableHead>
                <TableHead>Pensum</TableHead>
                <TableHead>Passwort setzen</TableHead>
                <TableHead>Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {org.members.map((m) => (
                <TableRow key={m.userId}>
                  <TableCell>{m.firstName} {m.lastName}</TableCell>
                  <TableCell className="text-xs font-mono">{m.email}</TableCell>
                  <TableCell><Badge variant="outline">{m.role}</Badge></TableCell>
                  <TableCell>{m.status}</TableCell>
                  <TableCell className="text-xs">{formatDate(m.entryDate)}</TableCell>
                  <TableCell className="text-xs">{formatDate(m.exitDate)}</TableCell>
                  <TableCell className="font-mono">{m.pensum}%</TableCell>
                  <TableCell>{m.mustSetPassword ? <Badge variant="destructive">ja</Badge> : "—"}</TableCell>
                  <TableCell>
                    <ResetLinkButton userId={m.userId} email={m.email} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section>
        <h2 className="font-display text-lg font-semibold tracking-tight mb-3">Nutzung je Monat (letzte 12 Monate)</h2>
        {org.monthlyUsage.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keine Einträge im Zeitraum.</p>
        ) : (
          <div className="rounded-lg border bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Monat</TableHead>
                  <TableHead>Einträge</TableHead>
                  <TableHead>Stunden</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {org.monthlyUsage.map((m) => (
                  <TableRow key={m.month}>
                    <TableCell className="font-mono text-xs">{m.month}</TableCell>
                    <TableCell className="font-mono">{m.entries}</TableCell>
                    <TableCell className="font-mono">{m.hours.toFixed(1)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section>
        <h2 className="font-display text-lg font-semibold tracking-tight mb-3">Feiertage je Jahr</h2>
        {org.holidaysByYear.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keine Feiertage gepflegt.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {org.holidaysByYear.map((h) => (
              <Badge key={h.year} variant="outline">{h.year}: {h.count}</Badge>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
