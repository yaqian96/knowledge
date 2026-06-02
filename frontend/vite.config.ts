import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backend = 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3001,
    strictPort: false,
    proxy: {
      '/conversations': backend,
      '/knowledge': backend,
      '/sources': backend,
      '/files': backend,
      '/ai': backend,
      '/voice': backend,
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
});
