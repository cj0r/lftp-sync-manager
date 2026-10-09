# Third-party notices

LFTP Sync Manager is licensed under the PolyForm Noncommercial License 1.0.0 (see `LICENSE`). It bundles these files from other projects, each under its own license:

| What | Where | License |
| --- | --- | --- |
| [Chart.js](https://www.chartjs.org) v4.4.7 | `public/vendor/chart.umd.min.js` | MIT |
| [Lucide](https://lucide.dev) icons v0.469.0 | `public/vendor/lucide.min.js` | ISC |
| [QRious](https://github.com/neocotic/qrious) v4.0.2 by Alasdair Mercer | `public/vendor/qrious.min.js` | GPL-3.0 |

The license notice each project ships stays at the top of its file. The web UI also loads the Outfit and JetBrains Mono fonts from Google Fonts (SIL Open Font License 1.1).

The Docker image is built on the official `node` Alpine image and installs `lftp`, OpenSSH, util-linux and tini from Alpine's packages, each under its own license. The Node dependencies installed into the image are listed in `package.json` and `pnpm-lock.yaml`.

LFTP Sync Manager talks to Discord, Telegram, Gotify and ntfy through their public APIs. It isn't endorsed by or affiliated with any of them.
