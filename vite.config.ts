import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The staff app. index.html lives in src/admin; the Worker serves the build under /admin/.
export default defineConfig({
  root: 'src/admin',
  base: '/admin/',
  plugins: [react()],
  build: { outDir: '../../dist/public/admin', emptyOutDir: true },
  server: { port: 5174 },
});
