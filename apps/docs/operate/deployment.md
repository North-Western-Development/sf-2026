# Deployment

This guide takes a fresh Linux server to a running instance at `https://subspace.click`. Replace the domain with yours everywhere.

## 1. What you need

- A Linux server (2 vCPU and 4 GB RAM is plenty for a small community) with a public IP.
- Docker Engine with the Compose plugin, and nginx with Certbot on the host.
- DNS records for your domain: see [Domains and DNS](/operate/domains).
- Open firewall ports: TCP 80 and 443 (web), UDP 50000-50100 and TCP 7881 (voice and video media). Nothing else needs to be public.

## 2. Get the code and configure it

```bash
git clone <your repository> /opt/subspace && cd /opt/subspace
cp .env.example .env
```

Generate the secrets and fill in `.env` ([every variable](/reference/configuration)):

```bash
openssl rand -hex 32   # run once for each of JWT_SECRET, POSTGRES_PASSWORD,
                       # MINIO_ROOT_PASSWORD and LIVEKIT_API_SECRET
```

At minimum set:

```ini
PUBLIC_ORIGIN=https://subspace.click
WEB_PORT=8080
JWT_SECRET=...
POSTGRES_PASSWORD=...
MINIO_ROOT_USER=subspace_minio
MINIO_ROOT_PASSWORD=...
LIVEKIT_API_KEY=subspace
LIVEKIT_API_SECRET=...
```

`PUBLIC_ORIGIN` must be the exact address people type. Passkeys, email links and presigned storage URLs are bound to it.

## 3. Start the stack

```bash
docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d --build
docker compose ps
```

What happens on start:

1. PostgreSQL, Redis, MinIO and LiveKit start.
2. The one-shot `migrate` service brings the database schema up to date, then exits.
3. The services start only after it succeeded.

`migrate` deliberately has no `--force`. If an upgrade would drop data, it stops and the services do not start. In that case run it interactively, read what it wants to do, and decide:

```bash
docker compose run --rm -it migrate
```

The staging overlay publishes only the web edge on `127.0.0.1:8080` and LiveKit's media ports. It also drops container capabilities and caps log sizes.

## 4. TLS and the host nginx

```bash
sudo mkdir -p /var/www/certbot
sudo cp deploy/nginx/subspace.conf /etc/nginx/conf.d/subspace.conf
sudo sed -i 's/subspace\.click/your.domain/g' /etc/nginx/conf.d/subspace.conf
```

Certbot needs the port-80 server first. Comment out the three `listen 443` server blocks, reload nginx, request the certificate, then restore them:

```bash
sudo nginx -t && sudo systemctl reload nginx
sudo certbot certonly --webroot -w /var/www/certbot \
  -d subspace.click -d app.subspace.click -d docs.subspace.click -d storage.subspace.click
sudo nginx -t && sudo systemctl reload nginx
```

If the server already runs other sites on 80/443, see [Reverse proxy](/operate/reverse-proxy).

## 5. First staff account

Sign up at `https://subspace.click`. On purpose, no API can grant the first staff rank. Promote your account in the database; ranks are 1 moderator, 2 admin, 3 root:

```bash
docker compose exec postgres psql -U subspace -d subspace_frequency \
  -c "UPDATE transmitters SET staff_rank = 3 WHERE username = 'you' AND discriminator = '1234';"
```

Sign out and back in. User Settings now has **Command Console**; see the [Operator manual](/operate/operator-manual).

## 6. Check it from outside

From any machine with the repository:

```bash
LIVE_URL=https://subspace.click pnpm test:live
```

This checks the following through the public domain:

- TLS and security headers;
- the API and the gateway WebSocket;
- a beacon with live messages between two accounts;
- file upload and download through storage;
- two people talking in a Comm-Link over real WebRTC media.

It registers two throwaway accounts unless you pass `LIVE_EMAIL`/`LIVE_PASSWORD` and `LIVE_EMAIL_2`/`LIVE_PASSWORD_2`, and deletes the beacon it made.

## 7. Updates

```bash
git pull
docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d --build
```

Take a [backup](/operate/backups) first. `migrate` runs on every start and is a no-op when nothing changed.

## The documentation site

```bash
pnpm --filter @subspace/docs build
sudo rsync -a --delete apps/docs/.vitepress/dist/ /var/www/subspace-docs/
```
