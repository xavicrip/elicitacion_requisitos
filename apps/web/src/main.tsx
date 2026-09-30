import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppRouter } from './app/router';
import { exposeWorkspaceForE2E } from './features/diagrams/workspace/store';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('No se encontró el elemento #root');

exposeWorkspaceForE2E();

createRoot(root).render(
  <StrictMode>
    <AppRouter />
  </StrictMode>,
);
