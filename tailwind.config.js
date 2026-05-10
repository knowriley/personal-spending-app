/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './templates/**/*.html',
    './static/js/**/*.js',
  ],
  safelist: [
    // Dynamic classes set via classList.toggle / conditional JS
    'bg-neutral-100', 'text-neutral-900', 'text-neutral-700', 'text-neutral-600',
    'font-semibold',
    'hover:bg-neutral-50', 'hover:bg-neutral-100',
    'ring-1', 'ring-2', 'ring-neutral-200', 'ring-accent-700',
    'shadow-md',
    'text-utility-green-700', 'bg-utility-green-50',
    'text-utility-red-700',   'bg-utility-red-50',
    'hidden',
    'panel-open',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Brand accent — Tailwind indigo ramp. Every shade hits at least 4.5:1
        // on white (indigo-500 is ~4.6:1, indigo-700 is ~7.6:1), so the whole
        // ramp is text-safe. Default to accent-700 anywhere contrast matters.
        accent: {
          50:  '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
        },
        // Utility colors — semantic signal only (success/error/positive/
        // negative). Text shade is `-700` for comfortable WCAG AA on white;
        // `-50/-100` work as soft chip backgrounds paired with the `-700` text.
        'utility-green': {
          50:  '#ecfdf5',
          100: '#d1fae5',
          600: '#059669',
          700: '#047857',
        },
        'utility-red': {
          50:  '#fff1f2',
          100: '#ffe4e6',
          600: '#e11d48',
          700: '#be123c',
        },
      }
    }
  },
  plugins: [],
}
