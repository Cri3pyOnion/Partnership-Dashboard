import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import './styles.css';

async function start() {
  // Dev only: `npm run preview:admin` (mode "mock") or ?mock=1 on the dev server. The whole
  // branch is removed from production builds because import.meta.env.DEV is a build-time false.
  if (import.meta.env.DEV && (import.meta.env.MODE === 'mock' || new URLSearchParams(location.search).has('mock'))) {
    const { installMockApi } = await import('./dev/mock-api');
    installMockApi();
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter basename="/admin">
        <App />
      </BrowserRouter>
    </StrictMode>,
  );
}

void start();
