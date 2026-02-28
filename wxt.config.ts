import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  outDir: 'dist',

  manifest: ({ browser }) => ({
    name: 'Redirect Inspector',
    description: 'Inspect and visualize redirect chains directly in your browser.',
    version: '2.1.1',
    author: '301.st — Smart Traffic <support@301.st>',
    homepage_url: 'https://301.st',

    ...(browser === 'chrome' && { minimum_chrome_version: '116' }),

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

    ...(browser !== 'firefox' && {
      side_panel: {
        default_path: 'popup.html?sidepanel=1',
      },
    }),

    ...(browser === 'firefox' && {
      sidebar_action: {
        default_panel: 'popup.html?sidepanel=1',
        default_title: 'Redirect Inspector',
        default_icon: { 16: 'icons/16.png', 32: 'icons/32.png' },
      },
    }),

    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          id: 'redirect-inspector@301.st',
          strict_min_version: '109.0',
          data_collection_permissions: {
            required: ['none'],
          },
        },
      },
    }),
  }),

  browser: 'chrome',
});
