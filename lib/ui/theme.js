export const themePresets = {
  amber: {
    border: { default: '#f59e0b', success: '#22c55e', error: '#ef4444', info: '#38bdf8' },
    text: { muted: '#94a3b8', accent: '#fbbf24', title: '#f8fafc' }
  },
  ocean: {
    border: { default: '#0ea5e9', success: '#22c55e', error: '#ef4444', info: '#06b6d4' },
    text: { muted: '#93c5fd', accent: '#22d3ee', title: '#e0f2fe' }
  },
  mono: {
    border: { default: '#a3a3a3', success: '#737373', error: '#525252', info: '#d4d4d4' },
    text: { muted: '#a3a3a3', accent: '#e5e5e5', title: '#fafafa' }
  }
};

export const uiTheme = {
  ...themePresets.amber,
  panel: {
    padding: { top: 0, right: 1, bottom: 0, left: 1 },
    margin: { top: 1, right: 0, bottom: 1, left: 0 }
  }
};

export function setUiThemePreset(name = 'amber') {
  const preset = themePresets[name] || themePresets.amber;
  uiTheme.border = { ...preset.border };
  uiTheme.text = { ...preset.text };
}

export function resolveThemeName(name = 'amber') {
  if (name !== 'auto') {
    return themePresets[name] ? name : 'amber';
  }
  if (process.env.CI) return 'mono';
  if (!process.stdout?.isTTY) return 'mono';
  return 'amber';
}
