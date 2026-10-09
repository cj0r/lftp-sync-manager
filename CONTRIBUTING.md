# Contributing

Thanks for helping out. Bug reports, ideas and pull requests are all welcome.

## Reporting a bug or asking for a feature

Open an issue with the matching form. For a bug, include the version (next to the logo in the web UI), how you run the container, and the sync log of the run that went wrong. Use **Download Redacted Log** (the shield icon in Live Logs) so your host and username stay out of it.

Security problems go through [SECURITY.md](SECURITY.md), not an issue.

## Working on the code

The server is a single Node file, `server.js` (Node 24, Express, `ws`). The web UI is plain HTML, CSS and JavaScript in `public/` with no build step; third-party browser libraries are vendored in `public/vendor/` at pinned versions and must not be loaded from a CDN (the Content-Security-Policy allows scripts from the app itself only).

Dependencies are managed with **pnpm**; don't commit a `package-lock.json`.

```bash
pnpm install
CONFIG_DIR=./config-local node server.js   # http://localhost:9342
```

Transfers need `lftp`, `ssh` and `script` (util-linux) on the machine. The easiest way to try a change end to end is the image:

```bash
docker build -t lftp-sync-manager:dev .
docker run --rm -p 9342:9342 -v "$PWD/config-local:/config" lftp-sync-manager:dev
```

Every child process is started with `spawn()` and an argument array, never through a shell, and anything placed in an `lftp` script goes through `escapeLftpArg()` (or `sanitizeLftpHost()` for host names). Keep it that way.

## Pull requests

- Open pull requests against `development`, the only long-lived branch. A release is a version tag on it: tagging `vX.Y.Z` publishes `:X.Y.Z` and `:latest`.
- Keep each pull request to one change, and check it in a real browser: the Content-Security-Policy and the service worker's cache can break the UI in ways `curl` won't show.
- Write settings, messages and docs in plain words for someone who isn't a developer.
- When a setting is added or changed, update the README.
- Add a line to `CHANGELOG.md` under **Unreleased**.
- A release bumps the version in `package.json` and the `app-version` badge in `public/index.html` together (CI checks they match), moves the changelog's Unreleased notes under the new version, and then pushes the `vX.Y.Z` tag.

By contributing you agree your work is released under the project's license, the PolyForm Noncommercial License 1.0.0.
