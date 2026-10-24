import React from 'react';
import ReactDOM from 'react-dom/client';
import { ContextMenuProvider } from '@subspace/ui';
import { AppShell } from './app/AppShell';
import { AuthGate } from './features/auth/AuthGate';
import { VerifyEmailPage } from './features/auth/VerifyEmailPage';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* Outermost so the browser context menu never appears, including on the auth screens. */}
    <ContextMenuProvider>
      {window.location.pathname === '/verify-email' ? (
        <VerifyEmailPage />
      ) : (
        <AuthGate>
          <AppShell />
        </AuthGate>
      )}
    </ContextMenuProvider>
  </React.StrictMode>
);
