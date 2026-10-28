# Setup screenshot provenance

`public/setup/paste-key.png` and `public/setup/connected.png` are genuine Chromium captures of the Levr Workspace settings interface, created on 28 October 2026. They show the empty credential form and the verified connection state. They contain no real account, API key, password, invitation token, or production research.

Recreate them after changing the setup interface:

```sh
npm run build
CHROMIUM_PATH=/usr/bin/chromium node scripts/capture-provider-setup.mjs
npm run build
```

The script uses an isolated in-memory database, a temporary encrypted credential directory, randomly generated test credentials, and an injected synthetic provider response. It captures actual rendered application elements without changing their DOM or styles. The connected example illustrates the application's success state; it is not evidence of successful collection from a real ScrapeCreators account. A full mobile-page review image is saved to `/tmp/levr-provider-setup-mobile.png` and is not bundled.

The first two setup steps link to `https://app.scrapecreators.com`, the official “Get API Key” destination documented by `scrapecreators-cli` version 1.0.87. External ScrapeCreators screens were not captured: the development environment's egress proxy rejected access to the website, application, and documentation hosts. The guide therefore labels the bundled images “In Levr” and does not represent them as ScrapeCreators screenshots.
