import { api, type VaultFile } from '../services/api';
import { confirmAction } from '../app/ui';

const DEFAULT_NOTICE =
  'Files uploaded to the Subspace Vault can be opened by anyone who has the link, and by instance staff. Do not upload sensitive or private data.';

/**
 * Upload a file to the Subspace Vault. The first upload requires accepting the
 * Quarantine Disclaimer; that prompt is shown in the standard dialog, then the upload
 * is retried. Resolves null if the user declines.
 */
export function uploadToVault(file: File): Promise<VaultFile | null> {
  return api.uploadVaultFile(file).catch((err: Error & { code?: string; disclaimerNotice?: string }) => {
    if (err.code !== 'DISCLAIMER_REQUIRED') throw err;
    return new Promise<VaultFile | null>((resolve, reject) => {
      let accepted = false;
      confirmAction({
        title: 'Before you upload',
        body: err.disclaimerNotice || DEFAULT_NOTICE,
        confirmLabel: 'I understand',
        onConfirm: async () => {
          accepted = true;
          await api.acceptUploadDisclaimer();
          api.uploadVaultFile(file).then(resolve, reject);
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
