'use client'

import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { applyTheme, getInitialTheme, prefersReducedMotion, saveTheme, type Theme } from './theme'

export type ThemeContextValue = {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => unknown
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme)
  const themeRef = useRef(theme)
  const transitionTimerRef = useRef<number | null>(null)

  useLayoutEffect(() => {
    themeRef.current = theme
    applyTheme(theme)
  }, [theme])

  useLayoutEffect(() => () => {
    if (transitionTimerRef.current !== null) window.clearTimeout(transitionTimerRef.current)
    delete document.documentElement.dataset.themeTransitioning
  }, [])

  const setTheme = useCallback((nextTheme: Theme) => {
    if (nextTheme === themeRef.current) {
      saveTheme(nextTheme)
      return
    }

    const update = () => {
      themeRef.current = nextTheme
      applyTheme(nextTheme)
      saveTheme(nextTheme)
      setThemeState(nextTheme)
    }

    if (prefersReducedMotion()) {
      update()
      return
    }

    const root = document.documentElement
    root.dataset.themeTransitioning = 'true'
    if (transitionTimerRef.current !== null) window.clearTimeout(transitionTimerRef.current)
    transitionTimerRef.current = window.setTimeout(() => {
      delete root.dataset.themeTransitioning
      transitionTimerRef.current = null
    }, 250)

    const viewTransitionDocument = document as ViewTransitionDocument
    if (typeof viewTransitionDocument.startViewTransition === 'function') {
      try {
        viewTransitionDocument.startViewTransition(update)
        return
      } catch {
        // Fall through to the synchronous, universally supported update.
      }
    }

    update()
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme(themeRef.current === 'light' ? 'dark' : 'light')
  }, [setTheme])

  const value = useMemo<ThemeContextValue>(() => ({ theme, setTheme, toggleTheme }), [setTheme, theme, toggleTheme])

  return <ThemeContext value={value}>{children}</ThemeContext>
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext)
  if (value === null) throw new Error('useTheme must be used within ThemeProvider.')
  return value
}
