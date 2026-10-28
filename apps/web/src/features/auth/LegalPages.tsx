import type { ReactNode } from 'react';
import { PixelStar } from './PixelStar';

/**
 * Public legal pages: /privacy, /terms and /sms (the SMS program terms, which also show how
 * people opt in to verification texts, as carriers require). Readable signed in or out.
 */

export const OPERATOR = 'North Western Development';
export const CONTACT_EMAIL = 'april.abney@northwesterndevelopment.com';
const UPDATED = 'October 27, 2026';

/** The consent wording on the phone number form; /sms shows the same text. */
export const SMS_CONSENT =
  'By selecting Send Code, you agree to receive a one-time verification code by text message from Subspace Frequency at this number. Message frequency: one message each time you request a code. Message and data rates may apply. Reply STOP to opt out, HELP for help. Your number is never shared for marketing.';

export const LEGAL_PATHS = ['/privacy', '/terms', '/sms'] as const;

function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="h-full w-full overflow-y-auto bg-void text-fg">
      <header className="border-b border-line bg-base">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4 sm:px-6">
          <a href="/" className="flex items-center gap-2 font-bold text-fg">
            <PixelStar size={20} /> Subspace Frequency
          </a>
          <nav aria-label="Legal" className="ml-auto flex gap-4 text-sm text-fg-muted">
            <a href="/privacy" className="hover:text-fg">Privacy</a>
            <a href="/terms" className="hover:text-fg">Terms</a>
            <a href="/sms" className="hover:text-fg">SMS</a>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="text-3xl font-bold">{title}</h1>
        <p className="mt-1 text-sm text-fg-subtle">Last updated {UPDATED}</p>
        <div className="legal mt-8 space-y-6 text-[15px] leading-relaxed text-fg-muted [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-fg [&_li]:ml-5 [&_li]:list-disc [&_a]:text-brand-sky [&_a:hover]:underline [&_strong]:text-fg">
          {children}
        </div>
      </main>
    </div>
  );
}

const Contact = () => <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;

const NotEu = () => (
  <p>
    <strong>Not available in the European Union.</strong> Subspace Frequency is not authorized for use in the EU or EEA, because it does not
    comply with the GDPR. Do not create an account if you are located there.
  </p>
);

export function PrivacyPage() {
  return (
    <Page title="Privacy Policy">
      <p>
        Subspace Frequency (subspace.click) is a chat, voice and video service run by {OPERATOR}. This policy says what we collect, why, and who
        else handles it. Questions: <Contact />.
      </p>
      <NotEu />

      <h2>What we collect</h2>
      <ul>
        <li><strong>Account:</strong> email address, username, display name, password (stored only as a hash), profile details you choose to add.</li>
        <li><strong>Phone number (optional):</strong> only if you add one to your account, to verify it with a one-time code.</li>
        <li><strong>Content:</strong> messages, files, reactions and other things you post. In end-to-end encrypted conversations we store only ciphertext we cannot read.</li>
        <li><strong>Technical:</strong> IP addresses and device information, used for security, rate limiting and abuse prevention. Each IP address is also checked against a country database kept on our server (DB-IP Lite), to refuse access from the EU, the EEA and the UK; the address is not sent anywhere for this. A refused visitor's address is never stored with any account, is logged only with its last part removed, and their browser is told to delete this site's cookies. Web server logs never keep full addresses and are deleted after 7 days.</li>
        <li><strong>Voice and video:</strong> relayed live through our own servers and not recorded by us. Clips are saved only on your own device.</li>
        <li>
          <strong>Activity status (optional, off unless you turn it on):</strong> the desktop app checks your computer for games on its built-in list, and games can report
          what you are doing in them. Only the game and those details are shared, with the people your Activity Privacy setting allows, while you play. It is never stored,
          and nothing else running on your computer is sent to us.
        </li>
      </ul>

      <h2>How we use it</h2>
      <p>
        To run the service: sign you in, deliver your messages and calls, keep accounts secure, stop spam and abuse, and contact you about your
        account. We do not sell personal information, show ads, or use advertising or analytics trackers.
      </p>

      <h2>Text messages</h2>
      <p>
        If you add a phone number, we text it a one-time verification code when you ask for one. Mobile numbers and SMS opt-in consent are never
        shared with or sold to third parties or affiliates for marketing or promotional purposes. See the <a href="/sms">SMS Terms</a>.
      </p>

      <h2>Who else handles data</h2>
      <ul>
        <li><strong>Twilio:</strong> sends verification texts and checks whether a number is a mobile line.</li>
        <li><strong>proxycheck.io:</strong> receives the IP address of someone verifying a phone number, to detect VPNs and proxies.</li>
        <li><strong>Our email provider:</strong> delivers account emails such as verification and password resets.</li>
        <li><strong>Services you connect:</strong> if you link an account (for example GitHub) or import from a cloud drive, we exchange data with that service at your request.</li>
        <li><strong>Law enforcement:</strong> when the law requires it.</li>
      </ul>

      <h2>Cookies and storage</h2>
      <p>
        We use only essential cookies and browser storage: to keep you signed in, remember your settings, and keep encryption keys on your device.
        No advertising, analytics or tracking cookies.
      </p>

      <h2>Keeping and deleting data</h2>
      <p>
        We keep your data while your account exists. You can delete your account in User Settings; your profile and personal data are then
        removed. Some records (for example moderation reports) may be kept as long as needed for safety or legal reasons.
      </p>

      <h2>Children</h2>
      <p>Subspace Frequency is not for children under 13, and we do not knowingly collect their information.</p>

      <h2>Changes</h2>
      <p>If this policy changes, we update the date above, and tell you in the app for significant changes.</p>
    </Page>
  );
}

export function TermsPage() {
  return (
    <Page title="Terms of Service">
      <p>
        These terms cover your use of Subspace Frequency (subspace.click), run by {OPERATOR}. By creating an account you agree to them and to the
        Subspace Directives shown at sign-up. Questions: <Contact />.
      </p>
      <NotEu />

      <h2>Your account</h2>
      <ul>
        <li>You must be at least 13 years old.</li>
        <li>Keep your login secure; you are responsible for activity on your account.</li>
        <li>Give accurate information, and one account per person unless we allow otherwise.</li>
      </ul>

      <h2>Acceptable use</h2>
      <p>
        Follow the Subspace Directives: no harassment, hate speech or threats, nothing illegal, no spam or impersonation, no malware or attempts to
        break the service. We may remove content and suspend or close accounts that break these rules.
      </p>

      <h2>Your content</h2>
      <p>
        You keep ownership of what you post. You give us the permission needed to store, transmit and show it to the people you share it with, so
        the service can work.
      </p>

      <h2>Text messages</h2>
      <p>
        Adding a phone number means agreeing to the <a href="/sms">SMS Terms</a>: one-time verification codes when you request them. Reply STOP
        to opt out, HELP for help. Message and data rates may apply.
      </p>

      <h2>Bots and developers</h2>
      <p>Applications, bots and webhooks must follow these terms; their developers are responsible for what they do.</p>

      <h2>No warranty</h2>
      <p>
        The service is provided as is, without warranties of any kind. To the extent the law allows, {OPERATOR} is not liable for indirect or
        consequential damages, or for lost data or content.
      </p>

      <h2>Ending</h2>
      <p>You can delete your account at any time. We may suspend or end access for breaking these terms, or if we stop running the service.</p>

      <h2>Changes</h2>
      <p>We may update these terms; the date above shows the latest version. Continuing to use the service means you accept the changes.</p>
    </Page>
  );
}

export function SmsTermsPage() {
  return (
    <Page title="SMS Terms">
      <p>
        <strong>Program:</strong> Subspace Frequency account verification, run by {OPERATOR}.
      </p>

      <h2>What we send</h2>
      <p>
        One-time verification codes, only when you ask for one while adding a phone number to your account. No marketing or promotional messages.
        Example: <em>“Subspace Frequency: your verification code is 123456. It expires in 10 minutes. Reply STOP to opt out.”</em>
      </p>
      <p>
        <strong>Frequency:</strong> one message per request (at most a few a day). Message and data rates may apply.
      </p>

      <h2>How you opt in</h2>
      <p>
        Signed in, open <strong>User Settings › My Account › Phone Number › Add</strong>, enter your mobile number and your password, and select{' '}
        <strong>Send Code</strong>. The form shows this consent text right above the button:
      </p>
      <figure aria-label="The phone number form" className="rounded-lg bg-raised p-5 ring-1 ring-line">
        <p className="text-lg font-semibold text-fg">Enter a phone number</p>
        <p className="mt-3 text-xs font-semibold uppercase text-fg-muted">Phone Number</p>
        <p className="mt-1 rounded-md border border-line bg-void px-3 py-2 text-fg-subtle">+1 555 010 0199</p>
        <p className="mt-3 text-xs font-semibold uppercase text-fg-muted">Current Password</p>
        <p className="mt-1 rounded-md border border-line bg-void px-3 py-2 text-fg-subtle">••••••••</p>
        <p className="mt-3 text-xs text-fg-muted">{SMS_CONSENT}</p>
        <p className="mt-4 text-right">
          <span className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-on-brand">Send Code</span>
        </p>
      </figure>
      <p>Nobody is texted without entering their own number this way. Phone numbers are never collected any other way.</p>

      <h2>Help and opting out</h2>
      <ul>
        <li>Reply <strong>STOP</strong> to any message to stop receiving texts. Reply <strong>START</strong> to receive them again.</li>
        <li>Reply <strong>HELP</strong> for help, or email <Contact />.</li>
        <li>You can also remove your number in User Settings at any time.</li>
      </ul>
      <p>Carriers are not liable for delayed or undelivered messages.</p>

      <h2>Privacy</h2>
      <p>
        Mobile numbers and SMS opt-in consent are never shared with or sold to third parties or affiliates for marketing or promotional purposes.
        See the <a href="/privacy">Privacy Policy</a>.
      </p>
    </Page>
  );
}

/** The legal page for a path, or null. */
export function legalPageFor(path: string) {
  if (path === '/privacy') return <PrivacyPage />;
  if (path === '/terms') return <TermsPage />;
  if (path === '/sms') return <SmsTermsPage />;
  return null;
}
