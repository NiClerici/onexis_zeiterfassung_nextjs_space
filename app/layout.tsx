import { DM_Sans, Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

export const dynamic = "force-dynamic";

// "next/font/google" lädt die Font-Dateien beim BUILD herunter und liefert
// sie danach unter der eigenen Domain aus (/_next/static/media/*.woff2) —
// per HTTP-Response verifiziert (MIGRATION.md Punkt 10, "Fonts selbst
// hosten statt Google-CDN"). Der Browser einer nutzenden Person stellt zu
// keinem Zeitpunkt eine Anfrage an fonts.googleapis.com/fonts.gstatic.com;
// es gibt also keinen Laufzeit-Drittdienst-Kontakt und keine IP-Weitergabe
// an Google. Das erfüllt den Punkt bereits — eine zusätzliche Umstellung
// auf next/font/local mit von Hand eingecheckten .woff2-Dateien würde
// keinen zusätzlichen Datenschutz-Nutzen bringen (die Build-Pipeline lädt
// ohnehin schon alle Abhängigkeiten aus externen Registries), nur unnötiges
// Risiko bei Lizenz/Versionsabgleich — deshalb bewusst nicht umgestellt.
const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-sans" });
const jakartaSans = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-display" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata = {
  title: "ONEXIS Zeiterfassung",
  description: "Interne Zeiterfassungs-App für ONEXIS",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    images: ["/og-image.png"],
  },
};

// viewportFit: "cover" macht die App-Inhalte hinter Notch/Home-Indicator
// zeichenbar — erst dadurch liefert env(safe-area-inset-bottom) (siehe
// .safe-area-pb in globals.css) auf dem iPhone einen Wert ungleich 0.
export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" suppressHydrationWarning>
      <body
        className={`${dmSans.variable} ${jakartaSans.variable} ${jetbrainsMono.variable} font-sans antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
