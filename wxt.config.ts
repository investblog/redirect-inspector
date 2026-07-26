import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  outDir: 'dist',

  manifest: ({ browser }) => ({
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    version: '2.3.0',
    default_locale: 'en',
    author: '301.st — Smart Traffic <support@301.st>',
    homepage_url: 'https://301.st',

    ...(browser === 'chrome' && { minimum_chrome_version: '116' }),

    permissions:
      browser === 'firefox'
        ? ['webRequest', 'storage', 'webNavigation', 'alarms']
        : ['webRequest', 'storage', 'webNavigation', 'alarms', 'sidePanel'],

    // Opt-in 301.sh news: requested at runtime from a user gesture, never at install
    optional_permissions: ['notifications'],

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
        default_title: '__MSG_extName__',
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

  hooks: {
    'build:manifestGenerated': (wxt, manifest) => {
      // Chromium: icon click opens the side panel (setPanelBehavior in the
      // background); a default_popup would take precedence over it, so drop it.
      // Firefox keeps the popup — its icon can't open the sidebar natively.
      if (wxt.config.browser !== 'firefox' && manifest.action) {
        delete (manifest.action as { default_popup?: string }).default_popup;
      }
    },
  },

  browser: 'chrome',
});
