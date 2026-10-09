# Changelog

Every release of LFTP Sync Manager, newest first. Versions follow [semantic versioning](https://semver.org): a new major version means a setting or the `/config` layout has to change by hand.

## Unreleased

## 2.5.3 (2026-10-09)

**Check before updating:** without a web password, the UI now only opens for browsers on your local network that connect to it directly. If you reach it through a reverse proxy without the app's own sign-in, set a password first (or set `ALLOW_REMOTE_WITHOUT_AUTH=true` if something in front of it already handles sign-in).

- Without a password, the web UI and its WebSocket only open from local network addresses, not through a proxy or from the internet.
- Requests that change something are refused when the browser says they come from another site, so a web page can't drive the app through your browser.
- Reverse-proxy headers are only trusted from proxies on loopback and private networks by default (`TRUST_PROXY` to change it), so the sign-in rate limit can't be dodged with a forged address.
- A saved SFTP password is only ever sent to the host it was saved for when testing a connection or authorizing a key.
- SSH host keys are kept in `/config/known_hosts`, so a server whose key changes is refused instead of trusted again after every container update.
- Two-factor secrets are generated with a secure random source and are 160 bits.
- Sign-in takes the same time for an unknown username as for a wrong password.
- Two-factor codes can't be used twice to sign in.
- New SSH keys are Ed25519 instead of RSA (existing keys keep working).
- The QR code library is now qrcode-generator (MIT) instead of QRious (GPL), and the fonts are served by the app instead of Google Fonts.
- Public mirroring uses a deploy key scoped to the public repo instead of a personal access token.
- Patched `proxy-addr` and `ip-address` through dependency overrides.
- The image installs exactly the dependency versions in `pnpm-lock.yaml`, contains only the app's own files, and has a Docker health check.
- `compose.yaml` starts the container with `no-new-privileges`.
- Docs reorganized: README, SECURITY, CONTRIBUTING, CHANGELOG and THIRD_PARTY_NOTICES, with screenshots moved to `docs/`.

## 2.5.2 (2026-09-10)

- Dependency maintenance: patched denial-of-service issues in `qs` and `body-parser`, an SSRF issue in `ip-address` (via `express-rate-limit`), and a buffer-bounds bug in `uuid`, plus a refreshed Alpine base image. No behavior changes.

## 2.5.1 (2026-08-13)

- The container runs under tini, which reaps the orphaned `ssh` helpers `lftp` leaves behind. They used to pile up until the container ran out of process slots.
- Running out of local resources is reported as a local problem and retried, instead of being mistaken for the remote host refusing connections and starting a 30-minute cooldown.

## 2.5.0 (2026-07-30)

- Notifications to Discord, Telegram, Gotify, ntfy or a custom JSON webhook on sync success and failure, file explorer transfers, cooldowns and failed sign-ins, set per profile with per-event toggles and a Test button.
- Live progress, plus pause, resume and abort, for file explorer transfers.
- A filtered log view with a switch to the raw `lftp` output, passwords masked everywhere, and a redacted log download.
- Security pass: an XSS fix in the transfer list, browser libraries vendored instead of loaded from CDNs, `config.json` written `0600`, every session revoked on a password change, and stored credentials never sent to the browser.
- Aborted syncs are reported as aborted, not as successes, and `lftp` no longer detaches into the background on resume.

## 2.4.4 (2026-07-27)

- Fixed the dashboard not reflowing on window resize and several file explorer layout regressions.

## 2.4.3 (2026-07-26)

- File explorer: multi-select with batch push, pull and delete, sortable and filterable listings, and rename.
- Dry Run Mode, Min Chunk, throttling, filters and the mirror options now apply to file explorer actions too.

## 2.4.2 (2026-07-26)

- Pause and resume a running push or pull sync.

## 2.4.1 (2026-07-25)

- npm is removed from the shipped image, which clears the `brace-expansion` and `tar` findings inside npm itself.

## 2.4.0 (2026-07-25)

- Push one local file or folder, or pull one remote one, straight from the file explorer.

## 2.2.0 (2026-07-24)

- Web sign-in with TOTP two-factor codes, several connection profiles, and security hardening.

## 2.1.x (2026-07-10 to 2026-07-23)

- Bandwidth limits and schedules, include and exclude filters, mirror options (delete, dry run, ignore time, only missing), child-process timeouts, accurate network statistics, a configurable speed-average window, and installable PWA support.

## 2.0.0 (2026-07-08)

- Live transfer queue and the two-pane file explorer.
