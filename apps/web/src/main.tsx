import React from 'react';
import ReactDOM from 'react-dom/client';
import { ContextMenuProvider } from '@subspace/ui';
import { AppShell } from './app/AppShell';
import { AuthGate } from './features/auth/AuthGate';
import { VerifyEmailPage } from './features/auth/VerifyEmailPage';
import { WidgetPage } from './features/invite/WidgetPage';
import { applyA11yPrefs } from './lib/a11yPrefs';
import { toast } from './app/ui';
import './index.css';

// Accessibility preferences apply before the first paint.
applyA11yPrefs();

const widgetId = /^\/widget\/([0-9a-f-]{36})\/?$/i.exec(window.location.pathname)?.[1];

const pasteBlocked = () => toast('Your browser blocked reading the clipboard. Press Ctrl+V to paste.', 'error');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* Outermost so the browser context menu never appears, including on the auth screens. */}
    <ContextMenuProvider onPasteBlocked={pasteBlocked}>
      {window.location.pathname === '/verify-email' ? (
        <VerifyEmailPage />
      ) : widgetId ? (
        // Embedded on other sites: public, no sign-in.
        <WidgetPage beaconId={widgetId} />
      ) : (
        <AuthGate>
          <AppShell />
        </AuthGate>
      )}
    </ContextMenuProvider>
  </React.StrictMode>
);
