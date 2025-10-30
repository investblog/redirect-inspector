# Redirect Inspector

Redirect Inspector is a lightweight Chrome Extension that captures redirect chains in real-time so you can understand how a browser request eventually lands on its destination. It is particularly useful for QA specialists, SEO experts, and developers investigating unexpected navigation flows.

## Features (MVP)

- 🧭 Records redirect chains as they happen using the `webRequest` API.
- 🧩 Groups multiple hops from the same request so you can follow the entire chain.
- 🗂️ Stores the most recent 50 redirect chains for quick reference.
- 🧹 Allows clearing the stored log with a single click.
- 📋 Presents key details for each hop (origin, destination, HTTP status, method, tab, initiator).
- 📤 Copies a shareable summary of any redirect chain straight to your clipboard.

## Getting Started

1. Clone this repository or download it as a ZIP archive.
2. In Chrome, navigate to `chrome://extensions/` and enable **Developer mode**.
3. Click **Load unpacked** and select this repository's root directory.
4. Trigger some redirects in another tab (e.g., visiting URLs known to redirect) and open the extension popup to inspect the captured chain.

## Project Structure

```
redirect-inspector/
├── manifest.json
├── src/
│   ├── background/
│   │   └── service-worker.js
│   └── popup/
│       ├── index.html
│       ├── popup.css
│       └── popup.js
└── README.md
```

## Versioning

This repository follows semantic versioning aligned with the Chrome extension manifest. The current version is **1.1.0**, reflecting the clipboard export release. Future updates should increment the manifest version and document notable changes in this README.

## Release History

- **1.1.0** — Added clipboard export for redirect chains and refreshed documentation.
- **1.0.0** — Initial MVP release.

## Development Notes

- The background service worker stores redirect entries inside `chrome.storage.local` so the popup can retrieve them.
- Redirect chains are grouped by request ID so the UI shows every hop from start to finish.
- The popup uses message passing to request the log and to clear it.
- Provide your own extension artwork (icons, screenshots) if you plan to publish the extension in the Chrome Web Store.
- To extend the extension (e.g., export logs, add filtering, or sync storage), build upon the existing modules under `src/`.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).
