/**
 * Theme management for Redirect Inspector
 * Supports: dark, light, auto (system preference)
 */

const THEME_STORAGE_KEY = 'redirect_inspector_theme';

export type Theme = 'dark' | 'light';
export type ThemePreference = Theme | 'auto';

/**
 * Get the current effective theme (dark or light)
 */
export function getTheme(): Theme {
  const root = document.documentElement;

  const explicit = root.dataset.theme as Theme | undefined;
  if (explicit === 'dark' || explicit === 'light') {
    return explicit;
  }

  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'dark' : 'light';
}

/**
 * Get the stored theme preference (dark, light, or auto)
 */
export function getThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY) as ThemePreference | null;
    if (stored === 'dark' || stored === 'light' || stored === 'auto') {
      return stored;
    }
  } catch {
    // localStorage may be blocked
  }
  return 'auto';
}

/**
 * Apply a theme to the document
 */
export function setTheme(theme: Theme | null): void {
  const root = document.documentElement;
  if (theme) {
    root.dataset.theme = theme;
  } else {
    delete root.dataset.theme;
  }
}

/**
 * Save theme preference and apply it
 */
export function setThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // localStorage may be blocked
  }

  if (preference === 'auto') {
    setTheme(null);
  } else {
    setTheme(preference);
  }
}

/**
 * Toggle between dark and light themes
 */
export function toggleTheme(): void {
  const current = getTheme();
  const next = current === 'dark' ? 'light' : 'dark';
  setThemePreference(next);
}

/**
 * Initialize theme system
 */
export function initTheme(): void {
  const preference = getThemePreference();

  if (preference === 'auto') {
    setTheme(null);
  } else {
    setTheme(preference);
  }

  try {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    mql.addEventListener('change', () => {
      if (getThemePreference() === 'auto') {
        document.dispatchEvent(new CustomEvent('themechange', { detail: getTheme() }));
      }
    });
  } catch {
    // matchMedia may not be available
  }
}

/**
 * Get theme icon name based on current theme
 */
export function getThemeIcon(theme: Theme): string {
  return theme === 'dark' ? 'moon' : 'sun';
}
