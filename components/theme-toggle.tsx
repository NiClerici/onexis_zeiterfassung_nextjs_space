'use client'

import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'

export function ThemeToggle() {
  // resolvedTheme statt theme: bei defaultTheme="system" ist `theme` oft
  // "system", nicht "light"/"dark" — ein Vergleich mit 'dark' würde beim
  // ersten Klick immer auf 'dark' setzen, auch wenn das System schon dunkel
  // steht. resolvedTheme liefert immer den tatsächlich aktiven Wert.
  const { resolvedTheme, setTheme } = useTheme()

  return (
    <Button
      variant="ghost"
      size="icon"
      className="relative"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
    >
      <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  )
}
