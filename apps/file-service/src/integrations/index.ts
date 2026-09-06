export interface CloudIntegrationConfig {
  provider: 'google' | 'onedrive' | 'dropbox';
  name: string;
  isEnabled: boolean;
  clientId?: string;
  apiKey?: string;
}

export function getCloudIntegrations(): Record<string, CloudIntegrationConfig> {
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleApiKey = process.env.GOOGLE_API_KEY;

  const onedriveClientId = process.env.ONEDRIVE_CLIENT_ID;
  const dropboxAppKey = process.env.DROPBOX_APP_KEY;

  return {
    google: {
      provider: 'google',
      name: 'Google Drive',
      isEnabled: Boolean(googleClientId),
      clientId: googleClientId,
      apiKey: googleApiKey,
    },
    onedrive: {
      provider: 'onedrive',
      name: 'Microsoft OneDrive',
      isEnabled: Boolean(onedriveClientId),
      clientId: onedriveClientId,
    },
    dropbox: {
      provider: 'dropbox',
      name: 'Dropbox',
      isEnabled: Boolean(dropboxAppKey),
      clientId: dropboxAppKey,
    },
  };
}
