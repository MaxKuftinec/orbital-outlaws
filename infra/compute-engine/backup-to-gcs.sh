#!/usr/bin/env bash
# Off-VM PostgreSQL backup. Run as the VM operator; no backup credentials in Git
set -euo pipefail

if [[ -z "${BACKUP_GCS_BUCKET:-}" ]]; then
  echo "Set BACKUP_GCS_BUCKET=gs://your-private-backup-bucket" >&2
  exit 2
fi
command -v gcloud >/dev/null || { echo "gcloud CLI is required" >&2; exit 2; }

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
env_file="$script_dir/.env"
if [[ ! -f "$env_file" ]]; then
  echo "Missing $env_file" >&2
  exit 2
fi

tmp="$(mktemp)"
chmod 600 "$tmp"
trap 'rm -f "$tmp"' EXIT
# The DB service supplies its own username/db name; avoid leaking a password
# into shell command history and do not publish a Postgres port on the VM
docker compose --env-file "$env_file" -f "$script_dir/compose.yaml" \
  exec -T database sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-acl' > "$tmp"
if [[ ! -s "$tmp" ]]; then
  echo "PostgreSQL dump is empty" >&2
  exit 1
fi
destination="${BACKUP_GCS_BUCKET%/}/orbital-outlaws-$(date -u +%Y%m%dT%H%M%SZ).dump"
gcloud storage cp "$tmp" "$destination"
echo "Backup uploaded: $destination"
