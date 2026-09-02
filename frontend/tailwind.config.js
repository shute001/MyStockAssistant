/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', '"PingFang SC"', '"Hiragino Sans GB"', '"Microsoft YaHei"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      colors: {
        dark: {
          bg: '#0F172A',
          card: '#1E293B',
          border: '#334155',
          hover: '#334155'
        },
        stock: {
          up: '#EF4444',
          down: '#10B981',
          flat: '#94A3B8'
        }
      }
    },
  },
  plugins: [],
}
