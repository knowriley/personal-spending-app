/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './templates/**/*.html',
    './static/js/**/*.js',
  ],
  safelist: [
    // Dynamic classes set via classList.toggle / conditional JS
    'bg-accent-100', 'text-accent-700', 'text-gray-600', 'hover:bg-gray-100',
    'ring-2', 'ring-accent-500', 'shadow-md',
    'bg-accent-50',
    'hidden',
    'panel-open',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        accent: {
          50:  '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
        }
      }
    }
  },
  plugins: [],
}
