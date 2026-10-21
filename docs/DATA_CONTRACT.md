# Shared data contract (v0.2)

Items marked **TO VERIFY** need M3 to confirm against real OceanVerse before final freeze.

## Run folder
`results/{dataset}_{split}_{model}_{feature_set}_seed{n}/` or `results/hybrid_fixed/{run}/` (depth ≤ 2 scan; basenames matching `^[\w.-]+$`). If duplicate basenames exist, the run under `hybrid_fixed/` is preferred with a warning.

| File | Shape / dtype | Notes |
|---|---|---|
| `truth.npy` | `(Y, 33, LAT, LON)` float32 | NaN on land / below seafloor. Never 0. |
| `pred_mean.npy` | same | NaN on land. |
| `pred_std.npy` | same | Finite and > 0 on ocean cells when `has_uncertainty: true`. Placeholder (zeros or dummy) when `has_uncertainty: false` or `pred_std_is_placeholder: true`. |
| `observed_mask.npy` | same, `uint8` or `bool` | 1/true = real-sampling-pattern observation exists. |
| `ocean_mask.npy` | `(33, LAT, LON)` or 4D, `uint8` or `bool` | 1/true = valid ocean cell (static or 4D). |
| `metrics.json` | see below | Written by shared evaluator. Uncertainty group stripped if no genuine uncertainty. |
| `config.json` | JSON | `dataset, split, model, feature_set, seed, source, has_uncertainty, pred_std_is_placeholder, x_drop, do_drop`. |
| `metadata.json` | JSON | see keys below. |
| `summary_by_year.csv` | CSV | Optional. |

- Array order: `(year, depth, latitude, longitude)`. Depth = 33 levels from paper Table 5 (0..5500 m).
- Missing: NaN in NumPy, `null` in JSON.
- `error = prediction - truth`.
- 90% interval: `mean ± 1.645 * std` (Gaussian head).

## Analysis Folder (`<run>/analysis/`)
Derived analysis files generated via `make analysis` (`ml/scripts/build_analysis.py`). Never committed to git (`**/analysis/*.npy` ignored):
- `observation_density.npy`: float32 `(Y, 33, LAT, LON)`. Fraction observed in a window of ±2 lat (edge-padded) × ±2 lon (circular wrap) × ±1 year (clamped), divided by valid ocean cells in the window (0 if none or land).
- `thresholds.json`: density quartile edges (`q0, q25, q50, q75, q100`) and std quartile edges from a seeded (0) 1% random sample of ocean cells.
- `density_bins.json`: metrics across density quartiles (`very_sparse`, `sparse`, `medium`, `well_observed`) on ocean cells.
- `by_depth.json`: metrics per depth index (0..32) for `all` and `never_observed`.
- `calibration.json`: nominal levels `[0.5, 0.8, 0.9, 0.95]` vs empirical coverage for `all`, `observed`, and `never_observed` (only when `has_uncertainty: true`).
- `uncertainty.json`: std deciles vs mean absolute error and RMSE (only when `has_uncertainty: true`).

## Flags and Capabilities
Flags can be specified in `config.json` OR `metadata.json`:
- `has_uncertainty` (bool, default `true`): `false` indicates model lacks genuine uncertainty head.
- `pred_std_is_placeholder` (bool, default `false`): `true` indicates `pred_std.npy` is dummy/placeholder and must never be shown as genuine uncertainty.
- `capabilities`:
  - `uncertainty`: `has_uncertainty === true && pred_std_is_placeholder !== true`
  - `density`: existence of `observation_density.npy`
  - `analysis`: available `.json` artifact names in `analysis/`
  - `physics`: existence of `physics_audit.npy`

## Metric Labeling Rules
- In UI, tables, and reports, label the `observed` metric group exactly:
  **`observed cells (contract group)`**
  (to distinguish from general validation cells).

## metadata.json keys
`dataset, split, model, seed, start_year, years[], depth_labels_m[], latitude_convention, longitude_convention, oxygen_units, normalization, simulation_caveat (must be true)`; optional `lat[]`, `lon[]`, `mock`, `capabilities`, `x_drop`, `do_drop`.

### TO VERIFY with M3
1. Latitude order: south -> north (index 0 = -87.5°).
2. Longitude range and coordinate shift: 180-cell longitude shift between graph representations (-180..180) vs truth grid (0..360).
3. Oxygen units & normalization strings.
4. Validation split cells vs observed cells definition.

## API (read-only, precomputed)
`GET /health /runs /metadata /metrics /comparison /map /density /timeseries /profile /reliability/:kind`
- `layer=uncertainty` returns 404 `not_available` if run lacks genuine uncertainty capability.
- In `/timeseries` and `/profile`, uncertainty bounds are `null` if run lacks genuine uncertainty.
- In `/metrics` and `/comparison`, uncertainty groups and `coverage90` are stripped / `null` for models without uncertainty.
- `/admin/rescan` with header `x-admin-token: <ADMIN_TOKEN>`, optional `?verify=1` for SHA-256 streaming verification.
