import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The staff app. index.html lives in src/admin; the Worker serves the build under /dashboard/.
export default defineConfig({
  root: 'src/admin',
  base: '/dashboard/',
  plugins: [react()],
  build: { outDir: '../../dist/public/dashboard', emptyOutDir: true },
  server: { port: 5174 },
});
