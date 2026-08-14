const path = require('path');

// Sicherheits-Header (MIGRATION.md Punkt 10) — gelten für jede Route.
//
// script-src/style-src brauchen 'unsafe-inline': Next.js App Router
// streamt den RSC-Payload und die Hydration-Daten über inline <script>-Tags
// ohne Nonce-Unterstützung in diesem Setup, und praktisch jede Karte in
// dieser App nutzt style={{ boxShadow: ... }} (CSS-Variablen für Schatten,
// siehe z.B. app/(app)/calendar/page.tsx) statt Tailwind-Klassen dafür —
// ein striktes style-src ohne 'unsafe-inline' würde die gesamte UI zerlegen.
// 'unsafe-eval' ist für den Next-Entwicklungsmodus (HMR) nötig; eine
// nonce-basierte, striktere CSP wäre eine sinnvolle spätere Verschärfung,
// aber ausserhalb des Rahmens dieses Punktes.
//
// connect-src 'self' genügt — per grep verifiziert, dass kein Client-Code
// fetch() gegen eine absolute externe URL aufruft (alle Aufrufe sind
// relative /api/-Pfade).
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: CSP },
  // HSTS nur sinnvoll unter HTTPS (Produktivbetrieb, siehe Punkt 11) — im
  // lokalen HTTP-Dev-Betrieb ignorieren Browser den Header ohnehin.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  output: process.env.NEXT_OUTPUT_MODE,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  experimental: {
    outputFileTracingRoot: path.join(__dirname, '../'),
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  images: { unoptimized: true },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.output.filename = 'static/chunks/[name]-[contenthash:8].js';
      config.output.chunkFilename = 'static/chunks/[contenthash:16].js';
    }
    return config;
  },
};

module.exports = nextConfig;
