# LFTP Sync Manager

A web control panel for `lftp`: push files from a local folder to an SFTP server and pull them back down with `lftp`'s segmented, parallel transfers, on a schedule or the moment a file lands in the folder.

[**Full documentation, screenshots and source on GitHub →**](https://github.com/cj0r/lftp-sync-manager)

- Push and pull syncs over SFTP, on cron schedules or as soon as the push folder changes.
- Several connection profiles, and an SSH key handshake so no password needs to be stored.
- A two-pane file explorer with per-item and batch transfers, live progress, pause, resume and abort.
- Notifications to Discord, Telegram, Gotify, ntfy or any webhook.
- Bandwidth limits, include and exclude filters, dry runs and true mirroring.
- Password and two-factor sign-in; without a password it only opens from your local network.

## Quick start

```yaml
services:
  lftp-sync-manager:
    image: cj0r/lftp-sync-manager:latest
    container_name: lftp-sync-manager
    restart: unless-stopped
    init: true
    security_opt:
      - no-new-privileges:true
    ports:
      - "9342:9342"
    volumes:
      - /path/to/config:/config              # settings, SSH keys, history, logs
      - /path/to/local/upload:/local-push    # files here are pushed to the remote host
      - /path/to/local/download:/local-pull  # pulled files land here
```

Run `docker compose up -d`, open `http://<host>:9342` from your local network and set a password under **Settings → Web Security & Authentication**. Images are built for `linux/amd64` and `linux/arm64`.

| Variable | Default | What it does |
| :--- | :--- | :--- |
| `PORT` | `9342` | Web UI port inside the container. |
| `CONFIG_DIR` | `/config` | Where settings, keys, history and logs are kept. |
| `TRUST_PROXY` | `loopback, linklocal, uniquelocal` | Which reverse proxies may set `X-Forwarded-*` headers. |
| `ALLOW_REMOTE_WITHOUT_AUTH` | `false` | Let it open from outside the local network without a password (only when sign-in happens in front of it). |

## Security

It holds the credentials of a remote server and can permanently delete files on both ends. Put it behind a reverse proxy with HTTPS before reaching it from outside your network, and prefer the built-in SSH key over a stored password. Provided as is, with no warranty, and used entirely at your own risk: see [Security](https://github.com/cj0r/lftp-sync-manager#security) and the [Disclaimer](https://github.com/cj0r/lftp-sync-manager#disclaimer) before deploying.

## Support the project

- [Buy Me A Coffee](https://www.buymeacoffee.com/cj0r)
- [Ko-fi](https://ko-fi.com/cj000r)
