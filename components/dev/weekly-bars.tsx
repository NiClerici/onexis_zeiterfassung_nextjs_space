// Schlichtes Balkenband für "Signups je Woche" — kein Chart-Package, nur
// relative Höhen auf Basis des grössten Werts in der Reihe.

export function WeeklyBars({ data }: { data: { weekStart: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="flex items-end gap-1 h-16">
      {data.map((d) => (
        <div key={d.weekStart} className="flex-1 flex flex-col items-center gap-1" title={`${d.weekStart}: ${d.count}`}>
          <div
            className="w-full rounded-t bg-primary/70 min-h-[2px]"
            style={{ height: `${(d.count / max) * 100}%` }}
          />
        </div>
      ))}
    </div>
  );
}
