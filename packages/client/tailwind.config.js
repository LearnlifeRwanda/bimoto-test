/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Interface face; overriding `sans` restyles the whole app via preflight.
        sans: [
          '"Space Grotesk"',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          '"Segoe UI"',
          'Roboto',
          '"Helvetica Neue"',
          'Arial',
          'sans-serif',
        ],
        // Wordmark + welcome headline only.
        display: ['"Playfair Display"', 'Georgia', '"Times New Roman"', 'serif'],
      },
      // UI-POLISH type scale — every screen picks from these five steps
      // (weight stays a separate utility so emphasis can vary per element).
      fontSize: {
        title: ['1.375rem', { lineHeight: '1.75rem' }], // 22/28 — page title
        heading: ['1.125rem', { lineHeight: '1.625rem' }], // 18/26 — section heading
        body: ['1rem', { lineHeight: '1.5rem' }], // 16/24 — primary content
        secondary: ['0.875rem', { lineHeight: '1.25rem' }], // 14/20 — supporting text
        caption: ['0.75rem', { lineHeight: '1rem' }], // 12/16 — labels, meta
      },
      colors: {
        primary: { DEFAULT: '#1B4F72', light: '#2E86C1', dark: '#154360' },
        accent: { DEFAULT: '#F39C12', light: '#F5B041', dark: '#D68910' },
        success: '#27AE60',
        danger: '#E74C3C',
        surface: '#F8F9FA',
      },
    },
  },
  plugins: [],
};
