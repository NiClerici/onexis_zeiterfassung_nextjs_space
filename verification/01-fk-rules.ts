import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
(async () => {
  const rows = await p.$queryRawUnsafe<any[]>(`
    SELECT tc.table_name AS child, kcu.column_name AS col,
           ccu.table_name AS parent, rc.delete_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
    JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
    WHERE tc.constraint_type='FOREIGN KEY' AND ccu.table_name IN ('Customer','Project')
    ORDER BY ccu.table_name, tc.table_name`);
  console.table(rows);
  const counts = await p.$queryRawUnsafe<any[]>(`
    SELECT (SELECT count(*) FROM "Customer") customers,
           (SELECT count(*) FROM "Project") projects,
           (SELECT count(*) FROM "CustomerMonth") customermonths,
           (SELECT count(*) FROM "TimeEntry" WHERE "customerId" IS NOT NULL) entries_with_customer`);
  console.log("Reale Datenmengen:", counts[0]);
  await p.$disconnect();
})().catch(e => { console.error("FEHLER:", e.message); process.exit(1); });
