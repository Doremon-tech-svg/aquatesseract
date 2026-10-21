# AquaTesseract

Sparse ocean dissolved-oxygen reconstruction on OceanVerse + trust analysis (uncertainty, observation density, physics audits) + Reconstruction Explorer.

> Results are evaluated on a **simulated** ocean. Predictions are not new measurements.

## Repo layout

> **Note:** This repository strictly uses `client/`, `server/`, and `ml/` (NOT `frontend/` or `backend/`).

| Path | Owner | What |
|---|---|---|
| `ml/src/aquatesseract/contract.py` | M1+M2+M3 (shared) | Data contract constants, `metrics_for()`, `metrics_streaming()`, `validate_run()` |
| `ml/scripts/` | ML team | `make_mock_run.py`, `validate_run.py`, `build_analysis.py`, `inventory.py` |
| `server/` | M4 | Express API, Postgres (run registry, published numbers). Scans `results/` up to depth 2 |
| `client/` | M5 | Vite + React Reconstruction Explorer & Landing Page |
| `results/` | all | Run folders (git-ignored): `{dataset}_{split}_{model}_{feature_set}_seed{n}/` or `hybrid_fixed/<run>` |
| `data/` | all | Raw OceanVerse data (git-ignored) + `CHECKSUMS.txt` |
| `docs/` | all | `DATA_CONTRACT.md` (v0.2), `api_reference.md`, `ML_RUNBOOK.md` |

Flow: `ML -> results/<run>/ -> read-only API -> client`. No live inference.

## Pinned toolchain (same for everyone)

| Tool | Version | Where pinned |
|---|---|---|
| Node | 20.15.1 | `.nvmrc`, `engines`, Dockerfiles |
| npm deps | exact versions + `package-lock.json` | always `npm ci`, never `npm install` |
| Python | 3.11 | `.python-version`, CI |
| Python deps | exact | `ml/requirements.txt` |
| torch 2.3.1 | per hardware | `ml/requirements-torch.txt` |
| Postgres | 16.3 | `docker-compose.yml` |

## Quick start

### A. Docker (Full stack: DB + API + Web)
```bash
cp .env.example .env
make setup       # node deps + python venv
make mock        # builds all 4 small mock variants
make check       # validates contract on all runs
make analysis    # builds reliability & density analysis
make up          # db :5433->5432, api :4000, web :5173
```
Open http://localhost:5173 (landing) or http://localhost:5173/#/explorer.
API health: http://localhost:4000/health

### B. Using Real Runs from ML Team
```bash
# 1. Copy delivered run folders into results/
cp -r /path/to/runs/* results/

# 2. Verify SHA-256 integrity (if CHECKSUMS.txt exists)
make verify

# 3. Validate contract compliance
make check

# 4. Generate derived analysis artifacts (density, calibration, depth profiles)
make analysis

# 5. Inventory inspection
make inventory
```

### C. Local Dev (Without Docker)
```bash
nvm use                 # node 20.15.1
make setup              # npm ci in client/server, python venv
make mock
docker compose up db -d # start postgres container (or use local postgres)
make dev-server         # terminal 1 (starts express on :4000)
make dev-client         # terminal 2 (starts vite on :5173)
```

## Rules that kill "works on my machine"

1. **Install only from lockfiles.** `npm ci`, `pip install -r ml/requirements.txt`. Need new dep? Add exact version, commit lockfile, mention in report.
2. **No absolute paths.** Use env vars (`RESULTS_DIR`, `DATABASE_URL`) or repo-relative paths. Config from `.env`, never committed.
3. **No big files in git.** `.npy/.nc/.pt/.mp4` ignored; pre-commit blocks >2 MB. Share data by checksum (`data/CHECKSUMS.txt`).
4. **One contract.** Array order `(year, depth, lat, lon)`, NaN on land, `error = prediction - truth`. Change only via PR touching `contract.py` + `docs/DATA_CONTRACT.md` + server together.
5. **Every run folder must pass `make check`** before M4/M5 touch it.
6. **One evaluator.** Metrics come from `contract.metrics_for()` / `metrics_streaming()`.
7. **Label sources.** `published` (paper) vs `reproduced` (ours, baselines) vs `hybrid` (ours). Never mixed.
8. **Label observed cells.** Use exact label **"observed cells (contract group)"** in all UI and reports.
9. **Seeds fixed and recorded** in `config.json`. Run naming: `{dataset}_{split}_{model}_{feature_set}_seed{n}`.
10. **CI must be green** to merge. `pre-commit install` once.

## Troubleshooting
- `/health` says `db:false` -> postgres not up or port 5432 in use. If host has local postgres, set `POSTGRES_PORT=5433` in `.env`. API still serves files.
- `make check` FAIL "NaN" -> land filled with 0. Must be NaN in `truth`/`pred_*`.
- Map upside-down / shifted 180° -> lat/lon convention unverified. Fix `metadata.json`, not the client.
