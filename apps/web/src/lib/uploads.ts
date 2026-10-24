import { api, type VaultFile } from '../services/api';
import { confirmAction } from '../app/ui';

const DEFAULT_NOTICE =
  'Files uploaded to the Subspace Vault can be opened by anyone who has the link, and by instance staff. Do not upload sensitive or private data.';

/**
 * Run a vault write that may need the first-upload Quarantine Disclaimer. If the server asks
 * for it, show it in the standard dialog, record acceptance and retry once. Resolves null if
 * the user dismisses the dialog.
 */
export function withUploadDisclaimer<T>(run: () => Promise<T>): Promise<T | null> {
  return run().catch((err: Error & { code?: string; disclaimerNotice?: string }) => {
    if (err.code !== 'DISCLAIMER_REQUIRED') throw err;
    return new Promise<T | null>((resolve, reject) => {
      let accepted = false;
      confirmAction({
        title: 'Before you upload',
        body: err.disclaimerNotice || DEFAULT_NOTICE,
        confirmLabel: 'I understand',
        onConfirm: async () => {
          accepted = true;
          await api.acceptUploadDisclaimer();
          run().then(resolve, reject);
        },
      });
      // Resolve null if the dialog is dismissed without accepting.
      void import('../app/ui').then(({ useUi }) => {
        const stop = useUi.subscribe((s) => {
          if (!s.dialog) {
            stop();
            if (!accepted) resolve(null);
          }
        });
      });
    });
  });
}

/** Upload a file to the Subspace Vault (see withUploadDisclaimer). */
export const uploadToVault = (file: File): Promise<VaultFile | null> => withUploadDisclaimer(() => api.uploadVaultFile(file));
