# Security

## Reporting a problem

Please don't open a public issue for a security problem. Report it privately through GitHub instead: on the repository's **Security** tab, choose **Report a vulnerability**. Say what you found, how to reproduce it, and which version you're running (shown next to the logo in the web UI).

You'll get an answer within a week. Once a fix is out, the changelog credits you unless you'd rather it didn't.

## Supported versions

Only the latest release gets security fixes. Update by pulling the newest image and recreating the container; your `/config` folder carries over.

## What LFTP Sync Manager protects

- The web UI can read stored connections, run transfers and delete files, so it asks for a password, and without one it only opens for browsers on your local network that connect to it directly. See the README's [Security](README.md#security) section for sign-in, two-factor codes and reverse proxy setup.
- The web password is stored only as a salted scrypt hash. SFTP passwords and notification tokens are stored as entered in `config.json` (readable only by its owner), and are never sent to the browser. An SSH key replaces the SFTP password entirely.
- Requests that change something are refused when they come from another site, and every page carries a strict Content-Security-Policy.

Problems in `lftp`, OpenSSH, or the services LFTP Sync Manager connects to belong with those projects.
