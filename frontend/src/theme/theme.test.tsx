import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from './ThemeProvider'
import { ThemeToggle } from './ThemeToggle'
import { THEME_STORAGE_KEY } from './theme'

function setMediaPreferences({ dark = false, reducedMotion = false } = {}) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn((query: string): MediaQueryList => ({
      matches: query === '(prefers-color-scheme: dark)' ? dark : reducedMotion,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    })),
  })
}

function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  )
}

describe('theme', () => {
  beforeEach(() => {
    delete document.documentElement.dataset.theme
    delete document.documentElement.dataset.themeTransitioning
    document.documentElement.style.colorScheme = ''
    setMediaPreferences()
  })

  it('initializes dark from localStorage', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    renderToggle()
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
  })

  it('initializes light from localStorage', () => {
    setMediaPreferences({ dark: true })
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light')
    renderToggle()
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
  })

  it('uses a dark system preference when no choice is saved', () => {
    setMediaPreferences({ dark: true })
    renderToggle()
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
  })

  it('uses a light system preference when no choice is saved', () => {
    renderToggle()
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
  })

  it('ignores an invalid saved value', () => {
    setMediaPreferences({ dark: true })
    window.localStorage.setItem(THEME_STORAGE_KEY, 'sepia')
    renderToggle()
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
  })

  it('does not crash when localStorage reads throw', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Storage is unavailable')
    })
    expect(() => renderToggle()).not.toThrow()
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
  })

  it('changes data-theme when the toggle is clicked', async () => {
    renderToggle()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Switch to dark mode' }))
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
  })

  it('saves the explicit theme after a click', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    renderToggle()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Switch to dark mode' }))
    expect(setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, 'dark')
  })

  it('updates its accessible label with the active theme', async () => {
    renderToggle()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Switch to dark mode' }))
    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('can be operated from the keyboard', async () => {
    renderToggle()
    const user = userEvent.setup()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Switch to dark mode' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeInTheDocument()
  })

  it('still switches when localStorage writes throw', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage is unavailable')
    })
    renderToggle()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Switch to dark mode' }))
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
  })
})
