export interface StoreInfo {
  url: string;
  icon: string;
  label: string;
}

const STORES: Record<string, StoreInfo> = {
  chrome: {
    url: 'https://chromewebstore.google.com/detail/redirect-inspector/jkeijlkbgkdnhmejgofbbapdbhjljdgg/reviews',
    icon: '/icons/chrome.svg',
    label: 'Chrome Web Store',
  },
  edge: {
    url: 'https://microsoftedge.microsoft.com/addons/detail/ckblhiaefgkhpgilekhcpapnkpihdlaa',
    icon: '/icons/edge.svg',
    label: 'Edge Add-ons',
  },
  firefox: {
    url: 'https://addons.mozilla.org/firefox/addon/redirect-inspector/',
    icon: '/icons/mozilla.svg',
    label: 'Firefox Add-ons',
  },
};

export function getStoreInfo(): StoreInfo | null {
  const info = STORES[import.meta.env.BROWSER] ?? null;
  if (info && !info.url) return null;
  return info;
}
