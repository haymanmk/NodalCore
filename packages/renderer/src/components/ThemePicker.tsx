import { useTheme } from '../contributions/ThemeProvider.js'

export function ThemePicker() {
  const { activeThemeId, available, setActiveThemeId } = useTheme()
  if (available.length === 0) return null

  return (
    <label className="theme-picker">
      <span className="theme-picker__label">Theme</span>
      <select
        className="theme-picker__select"
        value={activeThemeId}
        onChange={(e) => setActiveThemeId(e.target.value)}
      >
        <option value="">Default (dark)</option>
        {available.map((theme) => (
          <option key={`${theme.pluginId}:${theme.themeId}`} value={theme.themeId}>
            {theme.label} ({theme.pluginId})
          </option>
        ))}
      </select>
    </label>
  )
}
