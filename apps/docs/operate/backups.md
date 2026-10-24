# Backups and recovery

Three things hold state. Back up all three, at the same time if you can.

| What | Where | How |
| :--- | :--- | :--- |
| Database | `postgres_data` volume | `pg_dump` |
| Files | `minio_data` volume | `mc mirror` or a volume snapshot |
| Sessions, rate limits, presence | `redis_data` volume | Optional: losing it only signs everyone out |

## Database

```bash
docker compose exec -T postgres pg_dump -U subspace -d subspace_frequency -Fc \
  > backups/subspace-$(date +%F).dump
```

Restore into a fresh stack (services stopped):

```bash
docker compose up -d postgres
docker compose exec -T postgres pg_restore -U subspace -d subspace_frequency --clean --if-exists \
  < backups/subspace-2026-10-23.dump
docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d
```

## Files

With the MinIO client:

```bash
mc alias set subspace http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
mc mirror --overwrite subspace/subspace-vault backups/vault/
mc mirror --overwrite subspace/subspace-media backups/media/
```

Port 9000 is not published by default. Run `mc` in a container on the compose network, or temporarily publish `127.0.0.1:9000`.

## Schedule

A nightly cron job that dumps the database, mirrors both buckets, and copies everything off the server is enough for most instances. Test a restore on a spare machine now and then: an untested backup is a hope, not a backup.

::: warning End-to-end encrypted data
Encrypted conversations cannot be restored into readable form from a server backup. Only people's own devices hold the keys.
:::
