import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Tailwind v4 ships as a Vite plugin — no tailwind.config.ts needed.
// The CSS @theme block in index.css handles all customization.
export default defineConfig({
  plugins: [
    tailwindcss(), // must come before react() so CSS is processed first
    react(),
  ],
  // Vite uses /site as root when deployed via Vercel's Root Directory setting
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
