import React from 'react';
import ReactDOM from 'react-dom/client';
import { ContextMenuProvider } from '@subspace/ui';
import { AppShell } from './app/AppShell';
import { AuthGate } from './features/auth/AuthGate';
import { VerifyEmailPage } from './features/auth/VerifyEmailPage';
import { WidgetPage } from './features/invite/WidgetPage';
import { CookieNotice } from './features/auth/CookieNotice';
import { applyA11yPrefs } from './lib/a11yPrefs';
import { applyTheme } from './lib/theme';
import { trackVisualViewport } from './lib/viewport';
import { startTouchScrollIndicator } from './lib/scrollIndicator';
import { startLongPress } from './app/gestures';
import { toast } from './app/ui';
import './index.css';

// Theme and accessibility preferences apply before the first paint.
applyTheme();
applyA11yPrefs();
trackVisualViewport();
startTouchScrollIndicator();
startLongPress();

const widgetId = /^\/widget\/([1-9][0-9]{0,18})\/?$/i.exec(window.location.pathname)?.[1];

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
      {!widgetId && <CookieNotice />}
    </ContextMenuProvider>
  </React.StrictMode>
);
