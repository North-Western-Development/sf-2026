# Native deployment (one Debian 13 host)

Run in order, as root on the server. All scripts are safe to re-run.

| Step | Script | What it does |
| :--- | :--- | :--- |
| 1 | `01-harden.sh` | Admin logins (`deploy`, `april`: keys only, passwordless sudo), nftables firewall, fail2ban, automatic security updates with a 04:30 reboot when needed, kernel and network hardening |
| 2 | `02-ssh-lockdown.sh` | SSH keys only, no root login, only the admin logins. Run after testing them |
| 3 | `03-platform.sh` | Node 22, pnpm, MinIO and LiveKit; one system user per service; Postgres and Redis logins per service; secrets in `/etc/subspace` |
| 4 | `04-services.sh` | Sandboxed systemd units and nginx (port 80 for certificates, loopback `127.0.0.1:8080` for testing) |
| 5 | `deploy.sh` (on your machine) | Uploads the working tree; `release.sh` builds it as `subspace-build`, pushes the schema as the owner role, switches `current` and restarts |
| 6 | `05-certs.sh` | Let's Encrypt for every name once DNS points here; turns on HTTPS and LiveKit's TURN over TLS |

## Names (A records to the server)

`subspace.click`, `www.subspace.click`, `docs.subspace.click`, `storage.subspace.click` (MinIO console, staff addresses only), `turn.subspace.click` (LiveKit TURN).

## Open ports

| Port | Protocol | For |
| :--- | :--- | :--- |
| 22 | TCP | SSH (keys only, rate-limited, fail2ban) |
| 80, 443 | TCP | Web (HTTP only for certificates and the redirect) |
| 7881 | TCP | LiveKit media over TCP |
| 7882 | UDP | LiveKit media |
| 3478 | UDP | TURN |
| 5349 | TCP | TURN over TLS |
| 30000–40000 | UDP | TURN relay |

Everything else (Postgres, Redis, MinIO, the Node services, LiveKit signaling) listens on 127.0.0.1 only.

## Who runs what

| User | Runs | Can write |
| :--- | :--- | :--- |
| `subspace-api`, `subspace-gateway`, `subspace-files`, `subspace-badges` | the Node services | nothing on disk (read-only release, private /tmp) |
| `minio` | object storage | `/var/lib/minio` |
| `livekit` | voice and video | nothing |
| `subspace-build` | builds releases, pushes the schema | its own release while building |

Each service has its own Postgres login with SELECT/INSERT/UPDATE/DELETE only (the `subspace_owner` role changes the schema, during a release), its own Redis ACL user without admin commands, and the file service has a MinIO account limited to the two Subspace buckets.

## Region block (BLOCK_EU)

`/etc/subspace/region.env` holds `BLOCK_EU` for the api, gateway and file services (release.sh creates it with `BLOCK_EU=true` once, then leaves it alone). To turn the block off, set `BLOCK_EU=false` there and run `sudo systemctl restart subspace-api subspace-gateway subspace-files`.

The address ranges live in `/etc/subspace/eu-ranges.csv`, built by `eu-ranges.sh` from DB-IP Lite (CC BY 4.0; the block page credits it). The `subspace-eu-ranges.timer` refreshes them weekly and the services pick the new file up within a minute. Run it by hand with `sudo systemctl start subspace-eu-ranges`.

A refused visitor is turned away before anything else runs: nothing is stored for them (no session, rate-limit or account data), their address is logged only anonymized (IPv4 /24, IPv6 /48), and the 401 carries `Clear-Site-Data: "cookies"`. For everyone, nginx's access log is written with anonymized addresses (`/etc/nginx/conf.d/subspace-privacy.conf`) and nginx's logs, including the error log that names clients, are kept 7 days (`/etc/logrotate.d/nginx`). release.sh sets both up.

## Rollback

```bash
sudo ln -sfn /opt/subspace/releases/<previous> /opt/subspace/current
sudo systemctl restart subspace-api subspace-gateway subspace-files subspace-badges
```
