# Compute Engine foundation — Orbital Outlaws public alpha

**Status:** deployable configuration committed to the repository; **no Google
Cloud resources have been provisioned by this change**

## Architecture and rationale

- Firebase Hosting: public, static Vue 3 + Vuetify preview
- Compute Engine: one Ubuntu VM running Docker Compose
- Caddy: the VM's only web ingress on ports 80/443, automatic TLS
- FastAPI/uvicorn: one authoritative process, internal port 8000
- PostgreSQL 16: private Docker network, durable named volume
- Offsite backups: PostgreSQL custom-format dump to a private Cloud Storage
bucket using the VM's scoped service account

Initial suggested VM: `e2-standard-2` (2 dedicated vCPUs, 8 GB RAM), a 50 GB balanced persistent boot disk, and a **reserved static external IP** in `asia-southeast1` (Singapore). This is an initial sizing hypothesis; benchmark with 10–30 invited testers before increasing capacity. The VM and disk incur ongoing costs while running. Configure billing budgets/alerts

### Security state: PUBLIC PREVIEW, NOT LIVE MULTIPLAYER

The current project has **no account authentication**, uses client-generated pilot IDs, and simulates each pilot's sector independently. It is unsafe to publish the current WebSocket/command API to strangers. Consequently:

- `ORBITAL_DEV_COMMANDS=0` is hardcoded in Compose
- Caddy **denies** `/players`, `/worlds`, `/dev`, Swagger and OpenAPI
- `/` (health) and `/system` (read-only star data) remain publicly available
- Firebase public-preview build sets `VITE_PUBLIC_PREVIEW=1`, disables the anonymous-pilot WebSocket bridge and explicitly labels gameplay as an unpersisted local sandbox. It does not store online progression
- Do **not** turn developer commands on in this VM or delete Caddy's route restrictions to make gameplay work. Add verified identity, permission checks, rate limits and real multiplayer authority first
- HTTP access is TLS-terminated by Caddy. Keep ports 5432 and 8000 private. Restrict SSH access via OS Login/IAP rather than public 0.0.0.0/0 on port 22

## Provision the first VM

You need a Google Cloud project with billing enabled, a domain for the API, Firebase Hosting configured for the frontend, Docker, and Google Cloud CLI. Replace the placeholder values. These are **manual** instructions, not commands executed by ChatGPT

```bash
PROJECT_ID=your-project-id
REGION=asia-southeast1
ZONE=asia-southeast1-b
VM=orbital-outlaws-alpha

gcloud config set project "$PROJECT_ID"
gcloud services enable compute.googleapis.com
gcloud compute addresses create orbital-outlaws-ip --region "$REGION"
STATIC_IP="$(gcloud compute addresses describe orbital-outlaws-ip --region "$REGION" --format='value(address)')"

gcloud compute instances create "$VM" \
  --zone "$ZONE" \
  --machine-type e2-standard-2 \
  --image-family ubuntu-2404-lts-amd64 \
  --image-project ubuntu-os-cloud \
  --boot-disk-type pd-balanced \
  --boot-disk-size 50GB \
  --address "$STATIC_IP" \
  --tags orbital-outlaws-web

# Adjust --network if you use a custom VPC
gcloud compute firewall-rules create orbital-outlaws-https \
  --network default --direction INGRESS --action ALLOW \
  --rules tcp:80,tcp:443 --source-ranges 0.0.0.0/0 \
  --target-tags orbital-outlaws-web
```

Point the `api.example.com` DNS A record to `$STATIC_IP`. Do not configure a DNS record for a name you don't control. Firebase's frontend domain is separate; connect it following Firebase Hosting's domain wizard

Securely connect with `gcloud compute ssh "$VM" --zone "$ZONE" --tunnel-through-iap` after enabling OS Login/IAP and the appropriate IAP SSH firewall rule, or use an already authorized console SSH connection. Do not open SSH globally

On the VM, install Docker Engine + Compose plugin using the [official Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/)  
Then:

```bash
git clone https://github.com/MaxKuftinec/orbital-outlaws.git
cd orbital-outlaws
cp infra/compute-engine/.env.example infra/compute-engine/.env
# Edit API_DOMAIN to your real DNS name. Generate a URL-safe DB password:
openssl rand -hex 24
nano infra/compute-engine/.env
docker compose --env-file infra/compute-engine/.env \
  -f infra/compute-engine/compose.yaml up -d --build
docker compose --env-file infra/compute-engine/.env \
  -f infra/compute-engine/compose.yaml ps
curl -fsS "https://YOUR_API_DOMAIN/"
curl -fsS "https://YOUR_API_DOMAIN/system"
```

The password must be a secret hexadecimal string, not the example placeholder. Do not publish `.env`. Before inviting players, configure log rotation, Cloud Monitoring alerts, disk-space thresholds and regular backups. For VM operational updates, `git pull --ff-only` followed by `docker compose ... up -d --build` updates the API without dropping the named PostgreSQL volume; still take a backup before migrations

## Publish the initial browser sandbox with Firebase

```bash
cp frontend/.env.alpha.example frontend/.env.production.local
# Set VITE_API_BASE_URL to the actual public HTTPS API domain
# VITE_PUBLIC_PREVIEW=1 intentionally avoids persistent pilot API access
cd frontend
npm ci
npm run build
cd ..
firebase deploy --only hosting --project YOUR_FIREBASE_PROJECT_ID
```

Use Firebase CLI authenticated to the intended project, and connect a
custom frontend domain only after choosing one. The `firebase.json` at
the repository root serves `frontend/dist` as a static SPA. This is
not a server-controlled or persistent multiplayer alpha yet.

## Offsite database backups

The VM must have a dedicated service account with minimal bucket-scoped
permissions (at least `storage.objects.create` for its **private** bucket)
and Google Cloud CLI configured. Avoid JSON service-account keys checked
into files or Git. The backup script requires a local Compose runtime and
produces a custom-format PostgreSQL dump.

```bash
BACKUP_GCS_BUCKET=gs://YOUR_PRIVATE_BACKUP_BUCKET \
  bash infra/compute-engine/backup-to-gcs.sh
```

Schedule this at least daily with a systemd timer or cron after verifying
it works. Protect the bucket with retention/versioning as appropriate and
**run a restore drill** to an isolated database. Backups inside the same VM
disk are not sufficient.

## Release gate for authenticated, shared multiplayer

1. Firebase Authentication (or equivalent) integrated into frontend.
2. FastAPI verifies credentials for REST and WebSocket connections, maps

   authenticated identities to owned pilots, and closes anonymous access.
3. Shared sector/entity authority and transactions are designed and tested;

   existing per-pilot sectors do not let two human pilots meet.
4. Rate limits, abuse protections, observability, deployment rollback,

   backup restoration, and an initial 10–30 user load test.
5. Open the minimum necessary Caddy routes *only after* all those gates pass.

A single VM is a failure domain and cannot scale game servers horizontally
by itself. Later: separate PostgreSQL (possibly Cloud SQL), dedicated
simulation workers, a message/event bus, and admission/sharding as needed.
