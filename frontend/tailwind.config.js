/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        sidebar: {
          DEFAULT: '#12131C',
          hover: '#1C1E2B',
          border: '#232433',
        },
        primary: {
          50: '#f3f1ff',
          100: '#e9e5ff',
          200: '#d4cbff',
          300: '#b3a3ff',
          400: '#8f74ff',
          500: '#7C5CFC',
          600: '#6c3ff0',
          700: '#5b2fd4',
          800: '#4a27ab',
          900: '#3d2389',
        },
        success: {
          50: '#ecfdf5',
          500: '#22c55e',
          600: '#16a34a',
        },
        warning: {
          50: '#fffbeb',
          500: '#f59e0b',
          600: '#d97706',
        },
        danger: {
          50: '#fef2f2',
          500: '#ef4444',
          600: '#dc2626',
        },
        info: {
          50: '#eff6ff',
          500: '#3b82f6',
          600: '#2563eb',
        },
        surface: '#F7F7FB',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px 0 rgba(16, 24, 40, 0.04), 0 1px 3px 0 rgba(16, 24, 40, 0.06)',
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1rem',
      },
    },
  },
  plugins: [],
}
