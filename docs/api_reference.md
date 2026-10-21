# AquaTesseract API Reference

Base URL: `http://localhost:4000` (or `/api` in client proxy).
All data is read-only and precomputed from simulation runs.

## Endpoints

| Method | Endpoint | Query Parameters | Headers | Description | Capability / Gating Behaviour |
|---|---|---|---|---|---|
| `GET` | `/health` | none | none | Health check returning status, DB status, run count, results directory. | Live `db: await dbAlive()`. |
| `GET` | `/runs` | `ids` (optional `1`), `all` (optional `1`) | none | List of runs. Default returns `{ runs: [{ id, status, split, model, feature_set, seed, capabilities }] }`. | Default hides `invalid` runs; `?all=1` includes them. `?ids=1` returns array of run ID strings. |
| `GET` | `/metadata` | `run` (string, required) | `if-none-match` (optional) | Run metadata, configuration, dimensions, capabilities, caveats. | Sets `Cache-Control: public, max-age=3600` and `ETag`. Supports 304 Not Modified. |
| `GET` | `/metrics` | `run` (string, required) | `if-none-match` (optional) | Metrics JSON (`all`, `observed`, `never_observed`, `uncertainty`). | Strips `uncertainty` group if run lacks genuine uncertainty capability (`!capabilities.uncertainty`). Caching headers set. |
| `GET` | `/comparison` | none | none | Tabular model comparison across published and local runs. | Published rows marked with `split: "temporal"` and caveat note. Rows for runs without genuine uncertainty have `coverage90: null`. |
| `GET` | `/map` | `run`, `layer`, `year`, `depth`, `stride` (optional) | `if-none-match` (optional) | 2D horizontal slice of grid. `layer`: `truth`, `prediction`, `uncertainty`, `error`, `observed`, `density`. | `layer=uncertainty` returns `404 not_available` if `!capabilities.uncertainty`. Default `stride=2` if `LAT*LON > 20000`, response adds `stride`. Caching headers set. |
| `GET` | `/density` | `run`, `year`, `depth`, `stride` (optional) | `if-none-match` (optional) | Alias for `/map?layer=density`. Reads `analysis/observation_density.npy`. | Returns `404 not_available` if observation density array does not exist. |
| `GET` | `/timeseries` | `run`, `depth`, `lat`, `lon` | `if-none-match` (optional) | Time series across all years for a specific grid cell column. | Returns `422 land_cell` on land/seafloor cells. `lower90` and `upper90` fields are `null` if run lacks genuine uncertainty. Caching headers set. |
| `GET` | `/profile` | `run`, `year`, `lat`, `lon` | `if-none-match` (optional) | Vertical depth profile (33 levels) at a specific latitude/longitude. | Returns `422 land_cell` if column is entirely land. `std` field is `null` if run lacks genuine uncertainty. Caching headers set. |
| `GET` | `/reliability/:kind` | `run` (required). `:kind`: `density`, `calibration`, `depth`, `uncertainty`, `thresholds`. | `if-none-match` (optional) | Reads corresponding JSON analysis file in `<run>/analysis/`. | Returns `404 not_available` if the requested analysis artifact does not exist for this run. Caching headers set. |
| `POST` | `/admin/rescan` | `verify` (optional `1`) | `x-admin-token` (required) | Rescans `RESULTS_DIR` (depth ≤ 2), runs cheap checks, updates in-memory cache and DB. | Protected: returns `403 forbidden` if `x-admin-token` header does not match `ADMIN_TOKEN`. If `?verify=1`, streams SHA-256 (1 MB chunks) against `CHECKSUMS.txt`. |
| `GET` | `/physics-audit` | `run` (required) | none | Physics audit SAS layer array. | Currently returns `501 not_available` until format is finalized. |

## Error Responses

All error responses return standard JSON format:
```json
{
  "error": {
    "code": "error_code_string",
    "message": "Human readable error description"
  }
}
```

### Standard Error Codes

| HTTP Status | Error Code | Description |
|---|---|---|
| 400 | `bad_run` | `run` parameter is missing or does not match `^[\w.-]+$`. |
| 400 | `bad_param` | Integer query parameter out of range or malformed. |
| 400 | `bad_index` | Array indexing out of bounds. |
| 403 | `forbidden` | `x-admin-token` header missing or incorrect on `/admin/rescan`. |
| 404 | `run_not_found` | Run folder not discovered in `RESULTS_DIR`. |
| 404 | `not_available` | Requested capability (e.g. uncertainty layer, reliability analysis) is unavailable for this run. |
| 404 | `array_missing` | Required `.npy` array file not present in run folder. |
| 404 | `no_route` | Unknown API route. |
| 422 | `land_cell` | Queried coordinate is on land or below the ocean seafloor. |
| 500 | `internal` | Uncaught server error. |
