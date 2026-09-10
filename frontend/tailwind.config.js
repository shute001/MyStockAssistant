/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI Variable Text"',
          '"Segoe UI Variable"',
          '"Segoe UI"',
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei UI"',
          '"Microsoft YaHei"',
          '"Source Han Sans CN"',
          'sans-serif',
        ],
        mono: [
          '"JetBrains Mono"',
          '"Cascadia Mono"',
          '"Cascadia Code"',
          'Consolas',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'monospace',
        ],
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
