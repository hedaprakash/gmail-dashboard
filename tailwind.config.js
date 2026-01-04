/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#1a73e8',
        danger: '#dc3545',
        success: '#28a745',
        warning: '#ffc107',
        info: '#17a2b8'
      }
    },
  },
  plugins: [],
}
