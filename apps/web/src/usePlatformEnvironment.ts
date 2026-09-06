import { useState } from 'react';

export interface PlatformInfo {
  isDesktop: boolean;
  isMobile: boolean;
  isWeb: boolean;
  platformName: 'desktop' | 'mobile' | 'web';
  clientVersion: string | null;
}

export function usePlatformEnvironment(): PlatformInfo {
  const [info] = useState<PlatformInfo>(() => {
    if (typeof window === 'undefined') {
      return {
        isDesktop: false,
        isMobile: false,
        isWeb: true,
        platformName: 'web',
        clientVersion: null,
      };
    }

    const ua = window.navigator.userAgent;
    const desktopMatch = ua.match(/SubspaceDesktop\/([0-9.]+)/);
    const isDesktop = !!desktopMatch || !!(window as any).__TAURI__;
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);

    return {
      isDesktop,
      isMobile: !isDesktop && isMobile,
      isWeb: !isDesktop && !isMobile,
      platformName: isDesktop ? 'desktop' : isMobile ? 'mobile' : 'web',
      clientVersion: desktopMatch ? desktopMatch[1] : null,
    };
  });

  return info;
}
