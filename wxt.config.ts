import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  outDir: 'dist',

  manifest: ({ browser }) => ({
    name: 'Redirect Inspector',
    description: 'Inspect and visualize redirect chains directly in your browser.',
    version: '1.1.0',
    author: '301.st — Smart Traffic <support@301.st>',
    homepage_url: 'https://301.st/?utm_source=chrome-web-store&utm_medium=listing&utm_campaign=redirect-inspector',
    minimum_chrome_version: '116',

    permissions:
      browser === 'firefox'
        ? ['webRequest', 'storage', 'tabs', 'webNavigation']
        : ['webRequest', 'storage', 'tabs', 'webNavigation', 'sidePanel'],

    host_permissions: ['<all_urls>'],

    icons: {
      16: 'icons/16.png',
      32: 'icons/32.png',
      48: 'icons/48.png',
      128: 'icons/128.png',
    },

    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          id: 'redirect-inspector@301.st',
          strict_min_version: '109.0',
        },
      },
    }),
  }),

  browser: 'chrome',
});
