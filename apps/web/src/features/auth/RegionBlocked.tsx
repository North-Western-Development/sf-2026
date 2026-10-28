/** The custom 401 page for visitors from a refused region (see lib/regionBlock.ts). */
import { CONTACT_EMAIL, OPERATOR } from './LegalPages';
import { AuthLayout } from './AuthLayout';

export function RegionBlockedPage() {
  return (
    <AuthLayout>
      <section role="alert" aria-label="Not available in your region" className="text-center">
        <p className="font-[family-name:var(--font-display)] text-xs font-bold uppercase tracking-[0.3em] text-brand-gradient">Error 401</p>
        <h1 className="mt-3 text-2xl font-semibold text-fg">Not available in your region</h1>
        <p className="mt-4 text-sm leading-relaxed text-fg-muted">
          Subspace Frequency is not authorized for use in the European Union, the European Economic Area or the United Kingdom, because it does
          not comply with the GDPR. Access from your network is blocked.
        </p>
        <p className="mt-4 text-sm leading-relaxed text-fg-muted">
          If you are outside those places and still see this, email{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-brand-sky hover:underline">
            {CONTACT_EMAIL}
          </a>
          .
        </p>
        <nav aria-label="Legal" className="mt-6 flex justify-center gap-4 text-sm">
          <a href="/privacy" className="text-brand-sky hover:underline">Privacy Policy</a>
          <a href="/terms" className="text-brand-sky hover:underline">Terms of Service</a>
        </nav>
        <p className="mt-6 text-xs text-fg-subtle">
          {OPERATOR} ·{' '}
          <a href="https://db-ip.com" target="_blank" rel="noreferrer" className="hover:underline">
            IP Geolocation by DB-IP
          </a>
        </p>
      </section>
    </AuthLayout>
  );
}
