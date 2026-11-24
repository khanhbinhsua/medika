const token = (name) => ({ opacityValue }) =>
  opacityValue === undefined ? `rgb(var(--${name}))` : `rgb(var(--${name}) / ${opacityValue})`;

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: token('ink'), soft: token('ink-soft'), faint: token('ink-faint') },
        paper: token('paper'),
        surface: { DEFAULT: token('surface'), sunk: token('surface-sunk') },
        rule: { DEFAULT: token('rule'), strong: token('rule-strong') },
        accent: { DEFAULT: token('accent'), deep: token('accent-deep'), wash: token('accent-wash') },
        danger: { DEFAULT: token('danger'), wash: token('danger-wash') },
        warn: { DEFAULT: token('warn'), wash: token('warn-wash') },
        ok: { DEFAULT: token('ok'), wash: token('ok-wash') },
      },
      fontFamily: {
        sans: ['IBM Plex Sans', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        // Bo góc rất nhỏ: dụng cụ y tế, không phải app tiêu dùng
        DEFAULT: '2px',
        sm: '2px',
        md: '3px',
        lg: '4px',
      },
    },
  },
  plugins: [],
};
