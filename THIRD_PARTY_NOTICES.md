# Third-party notices

LFTP Sync Manager is licensed under the PolyForm Noncommercial License 1.0.0 (see `LICENSE`). It bundles these files from other projects, each under its own license:

| What | Where | License |
| --- | --- | --- |
| [Chart.js](https://www.chartjs.org) v4.4.7 | `public/vendor/chart.umd.min.js` | MIT |
| [Lucide](https://lucide.dev) icons v0.469.0 | `public/vendor/lucide.min.js` | ISC |
| [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) by Kazuhiko Arase | `public/vendor/qrcode.js` | MIT |
| [Outfit](https://fonts.google.com/specimen/Outfit) by Rodrigo Fuenzalida | `public/vendor/fonts/outfit-300-700.woff2` | SIL Open Font License 1.1 |
| [JetBrains Mono](https://www.jetbrains.com/lp/mono/) by JetBrains | `public/vendor/fonts/jetbrains-mono-400.woff2` | SIL Open Font License 1.1 |

The license notice each project ships stays at the top of its file where it has one. The fonts are latin subsets downloaded from Google Fonts, unmodified.

The Docker image is built on the official `node` Alpine image and installs `lftp`, OpenSSH, util-linux and tini from Alpine's packages, each under its own license. The Node dependencies installed into the image are listed in `package.json` and `pnpm-lock.yaml`.

LFTP Sync Manager talks to Discord, Telegram, Gotify and ntfy through their public APIs. It isn't endorsed by or affiliated with any of them.
