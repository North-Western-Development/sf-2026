# Reverse proxy

The host's nginx terminates TLS and forwards to the web edge on `127.0.0.1:8080`. The ready-made configuration is `deploy/nginx/subspace.conf`; this page explains what matters in it, for servers that already run other sites.

## Must-haves

**Forward the original Host.** Presigned storage URLs are signed for your public host. Rewriting `Host` makes every upload fail with a signature error:

```nginx
proxy_set_header Host $host;
proxy_set_header X-Forwarded-Proto https;
```

**Upgrade WebSockets** on `/gateway` and `/rtc`, with long timeouts:

```nginx
location ~ ^/(gateway|rtc) {
  proxy_pass http://127.0.0.1:8080;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection $connection_upgrade;   # map $http_upgrade, see the file
  proxy_set_header Host $host;
  proxy_read_timeout 3600s;
}
```

**Allow attachment-sized bodies**, and stream them instead of buffering:

```nginx
client_max_body_size 55m;
proxy_request_buffering off;
```

## Alongside existing sites

Nothing in Subspace needs ports 80 or 443 itself; only the host nginx listens there. Add the file to `/etc/nginx/conf.d/` (or `sites-available` plus a symlink) next to your other server blocks; `server_name` keeps them apart. Make sure no other site claims `default_server` for your Subspace names.

If port 8080 is taken, set `WEB_PORT` in `.env` and change the `upstream subspace_edge` address to match.

## Checking the configuration

Always check before reloading:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

To check the repository file on its own:

```bash
nginx -t -c "$PWD/deploy/nginx/nginx.test.conf"
```

This needs the certificate paths to exist, or comment out the `ssl_certificate` lines.

## Other proxies

Any proxy works if it preserves `Host`, upgrades WebSockets on `/gateway` and `/rtc`, and allows 55 MB request bodies. Caddy example:

```
subspace.click {
  reverse_proxy 127.0.0.1:8080
  request_body {
    max_size 55MB
  }
}
```
