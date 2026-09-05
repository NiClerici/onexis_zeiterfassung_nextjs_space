import { chromium } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
(async () => {
  const vor = await prisma.customer.count({ where: { name: "ZZZ-Verify-Kunde" } });
  const b = await chromium.launch();
  const page = await (await b.newContext()).newPage();
  let nativerDialog = false;
  page.on("dialog", async (d) => { nativerDialog = true; await d.dismiss(); });
  await page.goto("http://localhost:3000/login", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('input[type="email"]').pressSequentially("zzz-verify-browser@verify.local", { delay: 10 });
  await page.locator('input[type="password"]').pressSequentially("VerifyTest2026!", { delay: 10 });
  await page.waitForSelector('button[type="submit"]:not([disabled])', { timeout: 15000 });
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/calendar/, { timeout: 60000 });
  await page.goto("http://localhost:3000/profile", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(8000);

  const info = await page.evaluate(() => {
    const txt = Array.from(document.querySelectorAll("*")).find(
      (e) => e.children.length === 0 && e.textContent?.trim() === "ZZZ-Verify-Kunde");
    if (!txt) return { schritt: "Kundenname nicht gefunden" };
    let n: Element | null = txt;
    for (let i = 0; i < 8 && n; i++) {
      const btns = Array.from(n.querySelectorAll("button"));
      if (btns.length >= 2) {
        const klassen = btns.map((x) => x.querySelector("svg")?.getAttribute("class") ?? "?");
        (btns[btns.length - 1] as HTMLButtonElement).click();
        return { schritt: "geklickt", ebene: i, buttons: btns.length, svgKlassen: klassen };
      }
      n = n.parentElement;
    }
    return { schritt: "keine Buttons in der Zeile" };
  });
  console.log("DOM:", JSON.stringify(info));
  await page.waitForTimeout(1000);
  const modal = await page.locator("[role='alertdialog'],[role='dialog']").count();
  await page.waitForTimeout(2500);
  const nach = await prisma.customer.count({ where: { name: "ZZZ-Verify-Kunde" } });
  const toasts = await page.locator("[data-sonner-toast]").allInnerTexts();
  console.log(`Modal nach Klick: ${modal} | nativer confirm(): ${nativerDialog}`);
  console.log(`Toast: ${JSON.stringify(toasts)}`);
  console.log(`Kunden in DB: ${vor} -> ${nach}`);
  console.log(`ERGEBNIS: ${nach < vor && modal === 0 && !nativerDialog ? "GELOESCHT OHNE JEDE RUECKFRAGE" : "nicht bestaetigt"}`);
  await b.close(); await prisma.$disconnect();
})().catch(async (e) => { console.error("FEHLER:", e.message); await prisma.$disconnect(); process.exitCode = 1; });
