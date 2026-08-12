"use client";

import { SessionProvider } from "next-auth/react";
import { I18nProvider } from "@/lib/i18n";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ThemeProvider attribute="class" defaultTheme="light" disableTransitionOnChange>
        <I18nProvider>
          {children}
          <Toaster />
        </I18nProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
