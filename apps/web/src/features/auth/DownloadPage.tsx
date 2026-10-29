import { PixelStar } from './PixelStar';
import { AppDownloads } from '../settings/user/GetAppsTab';

/** Public /download page: the desktop and mobile apps, signed in or out (the homepage links here). */
export function DownloadPage() {
  return (
    <div className="h-full w-full overflow-y-auto bg-void text-fg">
      <header className="border-b border-line bg-base">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4 sm:px-6">
          <a href="/" className="flex items-center gap-2 font-bold text-fg">
            <PixelStar size={20} /> Subspace Frequency
          </a>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="text-3xl font-bold">Get the Apps</h1>
        <p className="mt-2 text-fg-muted">
          Subspace on your computer and your phone. Or skip the download and{' '}
          <a href="/login" className="text-brand-sky hover:underline">
            open it in your browser
          </a>
          .
        </p>
        <div className="mt-8">
          <AppDownloads />
        </div>
      </main>
    </div>
  );
}
