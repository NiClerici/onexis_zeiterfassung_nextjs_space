// V7: Browser-Nachweis für zwei UI-Funde. Nutzt ein Wegwerf-Konto und
// Playwright-Route-Interception. Fasst keine echten Daten an.
import { chromium } from "@playwright/test";
const BASE = "http://localhost:3000";
const EMAIL = "zzz-verify-browser@verify.local";
const PW = "VerifyTest2026!";

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const ergebnis: string[] = [];

  // --- Login ---
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 120000 });
  // Auf React-Hydration warten: vorher sind die onChange-Handler nicht gebunden,
  // fill() setzt dann nur den DOM-Wert und der Knopf bleibt disabled.
  await page.waitForTimeout(2500);
  await page.locator('input[type="email"]').pressSequentially(EMAIL, { delay: 15 });
  await page.locator('input[type="password"]').pressSequentially(PW, { delay: 15 });
  await page.waitForSelector('button[type="submit"]:not([disabled])', { timeout: 15000 });
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/calendar/, { timeout: 120000 });
  await page.waitForTimeout(6000);
  const normalText = await page.locator("body").innerText();
  ergebnis.push(`LOGIN ok, Kalender geladen (Textlaenge ${normalText.length})`);

  // --- Test A: 500 beim Laden der Einträge ---
  await page.route("**/api/time-entries?*", (r) =>
    r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Interner Serverfehler" }) })
  );
  await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(5000);
  const fehlerText = await page.locator("body").innerText();
  const zeigtFehler = /fehler|error|fehlgeschlagen|konnte nicht|erneut/i.test(fehlerText);
  const toastDa = await page.locator("[data-sonner-toast], [role='status'], [role='alert']").count();
  ergebnis.push(`TEST A: API liefert 500 -> Fehlerhinweis im Text: ${zeigtFehler} | Toasts: ${toastDa}`);
  await page.screenshot({ path: "verification/shot-a-500.png" });
  await page.unroute("**/api/time-entries?*");

  // --- Test B: Papierkorb beim Kunden ---
  await page.goto(`${BASE}/profile`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(8000);
  let dialogAufgetaucht = false;
  page.on("dialog", async (d) => { dialogAufgetaucht = true; await d.dismiss(); });

  const kundeVorher = await page.getByText("ZZZ-Verify-Kunde").count();
  // Der Papierkorb neben dem Kundennamen
  const row = page.locator("div").filter({ hasText: /^ZZZ-Verify-Kunde/ }).last();
  const trash = row.locator("button").last();
  const trashDa = await trash.count();
  if (trashDa > 0) {
    await trash.click();
    await page.waitForTimeout(1500);
    const modal = await page.locator("[role='alertdialog'], [role='dialog']").count();
    const kundeNachher = await page.getByText("ZZZ-Verify-Kunde").count();
    ergebnis.push(`TEST B: Papierkorb geklickt -> Bestaetigungsdialog: ${modal > 0 || dialogAufgetaucht} | Kunde vorher/nachher: ${kundeVorher}/${kundeNachher}`);
    await page.screenshot({ path: "verification/shot-b-delete.png" });
  } else {
    ergebnis.push("TEST B: Loeschknopf nicht gefunden (Selektor)");
    await page.screenshot({ path: "verification/shot-b-notfound.png" });
  }

  console.log("\n===== ERGEBNIS =====");
  ergebnis.forEach((z) => console.log("  " + z));
  await browser.close();
})().catch((e) => { console.error("FEHLER:", e.message); process.exitCode = 1; });
