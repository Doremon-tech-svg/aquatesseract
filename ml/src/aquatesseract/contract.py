"""Single source of truth for the shared data contract. See docs/DATA_CONTRACT.md.

Nobody changes array order, units, masking or coordinates silently.
Change here + docs + server together, in one PR, reviewed by all ML members.

D3 update: validate_run and metrics_streaming are memory-safe (mmap, per-year streaming).
metrics_for() is kept for small-array usage by tests; it loads the full array into memory.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np

ARRAY_ORDER = ("year", "depth", "lat", "lon")
N_DEPTH = 33
# Table 5 of the OceanVerse paper: depth level centres (m)
DEPTH_LEVELS_M = [0, 10, 20, 30, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 600, 700, 800,
                  900, 1000, 1100, 1200, 1300, 1400, 1500, 1750, 2000, 2500, 3000, 3500, 4000,
                  4500, 5000, 5500]
assert len(DEPTH_LEVELS_M) == N_DEPTH

REQUIRED_FILES = ["pred_mean.npy", "pred_std.npy", "truth.npy", "observed_mask.npy",
                  "ocean_mask.npy", "metrics.json", "config.json", "metadata.json"]
OPTIONAL_FILES = ["observation_density.npy", "physics_audit.npy", "summary_by_year.csv"]
METADATA_KEYS = ["dataset", "split", "model", "seed", "start_year", "years", "depth_labels_m",
                 "latitude_convention", "longitude_convention", "oxygen_units", "normalization",
                 "simulation_caveat"]
METRIC_GROUPS = ["all", "observed", "never_observed"]
METRIC_KEYS = ["rmse", "mae", "r2", "n"]
UNC_KEYS = ["coverage90", "mean_width90", "coverage90_observed", "coverage90_never_observed"]
Z90 = 1.645
RUN_NAME_FMT = "{dataset}_{split}_{model}_{feature_set}_seed{seed}"


def _read_flags(d: Path) -> dict[str, Any]:
    """Read has_uncertainty / pred_std_is_placeholder from config.json or metadata.json."""
    flags: dict[str, Any] = {}
    for fname in ("config.json", "metadata.json"):
        fp = d / fname
        if fp.exists():
            data = json.loads(fp.read_text())
            if "has_uncertainty" in data:
                flags["has_uncertainty"] = data["has_uncertainty"]
            if "pred_std_is_placeholder" in data:
                flags["pred_std_is_placeholder"] = data["pred_std_is_placeholder"]
    return flags


def metrics_for(pred: np.ndarray, truth: np.ndarray, std: np.ndarray | None = None,
                observed: np.ndarray | None = None) -> dict:
    """THE evaluator core. Land = NaN in truth and is excluded. error = prediction - truth.

    Small-array version (loads fully into memory). For large runs use metrics_streaming().
    """
    ocean = np.isfinite(truth)
    obs: np.ndarray
    if observed is not None:
        obs = observed.astype(bool) & ocean
    else:
        obs = np.zeros_like(ocean)
    groups = {"all": ocean, "observed": obs, "never_observed": ocean & ~obs}
    out: dict = {}
    for name, m in groups.items():
        n = int(m.sum())
        if n == 0:
            out[name] = {"rmse": None, "mae": None, "r2": None, "n": 0}
            continue
        e = pred[m].astype(np.float64) - truth[m].astype(np.float64)
        ss_tot = float(((truth[m].astype(np.float64) - truth[m].astype(np.float64).mean()) ** 2).sum())
        out[name] = {"rmse": float(np.sqrt((e ** 2).mean())), "mae": float(np.abs(e).mean()),
                     "r2": float(1 - (e ** 2).sum() / ss_tot) if ss_tot > 0 else None, "n": n}
    if std is not None:
        inside = np.abs(pred - truth) <= Z90 * std

        def cov(m: np.ndarray) -> float | None:
            return float(inside[m].mean()) if m.any() else None

        out["uncertainty"] = {"coverage90": cov(groups["all"]),
                              "mean_width90": float((2 * Z90 * std[groups["all"]]).mean()),
                              "coverage90_observed": cov(groups["observed"]),
                              "coverage90_never_observed": cov(groups["never_observed"])}
    return out


def metrics_streaming(run_dir: str | Path) -> dict:
    """Memory-safe evaluator: streams one year at a time using mmap.

    Reads flags from config.json/metadata.json. If has_uncertainty=False,
    skips uncertainty metrics entirely.

    Returns the same structure as metrics.json.
    """
    d = Path(run_dir)
    flags = _read_flags(d)
    has_unc = flags.get("has_uncertainty", True) and not flags.get("pred_std_is_placeholder", False)

    mean_mm = np.load(d / "pred_mean.npy", mmap_mode="r")
    truth_mm = np.load(d / "truth.npy", mmap_mode="r")
    obs_mm = np.load(d / "observed_mask.npy", mmap_mode="r")
    ocean_mm = np.load(d / "ocean_mask.npy", mmap_mode="r")
    std_mm = np.load(d / "pred_std.npy", mmap_mode="r") if has_unc else None

    Y = truth_mm.shape[0]
    ocean_3d = np.asarray(ocean_mm).astype(bool)
    if ocean_3d.ndim == 4:
        ocean_3d = ocean_3d[0]  # use first year's mask if 4D

    # Accumulators per group: n, sum_e2, sum_ae, sum_t, sum_t2
    groups_names = ["all", "observed", "never_observed"]
    acc: dict[str, dict[str, float]] = {
        g: {"n": 0.0, "se2": 0.0, "sae": 0.0, "st": 0.0, "st2": 0.0} for g in groups_names
    }
    unc_acc: dict[str, dict[str, float]] = {
        g: {"inside": 0.0, "n": 0.0} for g in groups_names
    } if has_unc else {}
    width_sum = 0.0
    width_n = 0

    for y in range(Y):
        t = np.asarray(truth_mm[y]).astype(np.float64)
        p = np.asarray(mean_mm[y]).astype(np.float64)
        obs_y = np.asarray(obs_mm[y]).astype(bool)

        # ocean_3d broadcast
        ocean = ocean_3d if ocean_3d.ndim == t.ndim else np.broadcast_to(ocean_3d, t.shape)
        ocean = ocean & np.isfinite(t)

        obs = obs_y & ocean
        never = ocean & ~obs

        g_masks = {"all": ocean, "observed": obs, "never_observed": never}

        if has_unc:
            s = np.asarray(std_mm[y]).astype(np.float64)  # type: ignore[index]
            ins = np.abs(p - t) <= Z90 * s

        for g, m in g_masks.items():
            if not m.any():
                continue
            e = p[m] - t[m]
            a = acc[g]
            a["n"] += float(m.sum())
            a["se2"] += float((e ** 2).sum())
            a["sae"] += float(np.abs(e).sum())
            a["st"] += float(t[m].sum())
            a["st2"] += float((t[m] ** 2).sum())
            if has_unc:
                unc_acc[g]["inside"] += float(ins[m].sum())
                unc_acc[g]["n"] += float(m.sum())
                if g == "all":
                    width_sum += float((2 * Z90 * s[m]).sum())
                    width_n += int(m.sum())

    out: dict = {}
    for g in groups_names:
        a = acc[g]
        n = int(a["n"])
        if n == 0:
            out[g] = {"rmse": None, "mae": None, "r2": None, "n": 0}
            continue
        rmse = float(np.sqrt(a["se2"] / n))
        mae = float(a["sae"] / n)
        mean_t = a["st"] / n
        ss_tot = a["st2"] - n * mean_t ** 2
        r2 = float(1 - a["se2"] / ss_tot) if ss_tot > 0 else None
        out[g] = {"rmse": rmse, "mae": mae, "r2": r2, "n": n}

    if has_unc:
        def cov_unc(g: str) -> float | None:
            u = unc_acc[g]
            return float(u["inside"] / u["n"]) if u["n"] > 0 else None

        out["uncertainty"] = {
            "coverage90": cov_unc("all"),
            "mean_width90": float(width_sum / width_n) if width_n > 0 else None,
            "coverage90_observed": cov_unc("observed"),
            "coverage90_never_observed": cov_unc("never_observed"),
        }
    return out


def validate_run(run_dir: str | Path) -> list[str]:
    """Return list of problems. Empty list = run folder obeys contract.

    Memory-safe: uses mmap_mode='r' and checks headers/shapes without full load.
    Reads has_uncertainty / pred_std_is_placeholder from config.json OR metadata.json.
    Accepts observed_mask dtype bool or uint8. Accepts ocean_mask shape (D,L,L) or 4D.
    If has_uncertainty is False, skips std>0 check and uncertainty metric group.
    """
    d = Path(run_dir)
    errs: list[str] = []
    for f in REQUIRED_FILES:
        if not (d / f).exists():
            errs.append(f"missing file: {f}")
    if errs:
        return errs

    meta = json.loads((d / "metadata.json").read_text())
    flags = _read_flags(d)
    has_unc = flags.get("has_uncertainty", True) and not flags.get("pred_std_is_placeholder", False)

    errs += [f"metadata missing key: {k}" for k in METADATA_KEYS if k not in meta]
    if meta.get("simulation_caveat") is not True:
        errs.append("metadata.simulation_caveat must be true")

    # Open with mmap — no full load
    L = {k: np.load(d / f, mmap_mode="r") for k, f in
         [("mean", "pred_mean.npy"), ("std", "pred_std.npy"), ("truth", "truth.npy"),
          ("obs", "observed_mask.npy"), ("ocean", "ocean_mask.npy")]}
    shape = L["truth"].shape
    if len(shape) != 4:
        return errs + [f"truth must be 4D {ARRAY_ORDER}, got {shape}"]
    for k in ("mean", "std", "obs"):
        if L[k].shape != shape:
            errs.append(f"{k} shape {L[k].shape} != truth shape {shape}")
    # Accept ocean_mask as 3D (D,LAT,LON) or 4D
    if L["ocean"].shape != shape[1:] and L["ocean"].shape != shape:
        errs.append(f"ocean_mask shape {L['ocean'].shape} must be {shape[1:]} or {shape}")
    if shape[1] != N_DEPTH or len(meta.get("depth_labels_m", [])) != shape[1]:
        errs.append(f"depth axis must be {N_DEPTH} and match depth_labels_m")
    if len(meta.get("years", [])) != shape[0]:
        errs.append("len(metadata.years) != shape[0]")
    for k in ("mean", "std", "truth"):
        if L[k].dtype != np.float32:
            errs.append(f"{k} dtype must be float32, got {L[k].dtype}")
    # Accept obs dtype bool or uint8
    if L["obs"].dtype not in (np.uint8, np.bool_):
        errs.append(f"observed_mask dtype must be uint8 or bool, got {L['obs'].dtype}")
    if L["ocean"].dtype not in (np.uint8, np.bool_):
        errs.append(f"ocean_mask dtype must be uint8 or bool, got {L['ocean'].dtype}")
    if errs:
        return errs

    # Per-year streaming checks (no full load)
    Y = shape[0]
    ocean_base = np.asarray(L["ocean"]).astype(bool)
    if ocean_base.ndim == 4:
        ocean_base = ocean_base[0]

    for y in range(Y):
        t = np.asarray(L["truth"][y])
        p = np.asarray(L["mean"][y])
        ocean = np.broadcast_to(ocean_base, t.shape)

        if not np.isfinite(p[ocean]).all():
            errs.append(f"pred_mean has NaN/Inf on ocean cells (year idx {y})")
            break
        if not np.isfinite(t[ocean]).all():
            errs.append(f"truth has NaN on ocean cells (year idx {y})")
            break
        if np.isfinite(t[~ocean]).any():
            errs.append(f"land/invalid cells must be NaN in truth (year idx {y}) — never 0")
            break
        obs_y = np.asarray(L["obs"][y]).astype(bool)
        if obs_y[~ocean].any():
            errs.append(f"observed_mask set on land cells (year idx {y})")
            break
        if has_unc:
            s = np.asarray(L["std"][y])
            if not (np.isfinite(s[ocean]).all() and (s[ocean] > 0).all()):
                errs.append(f"pred_std must be finite and > 0 on ocean cells (year idx {y})")
                break

    m = json.loads((d / "metrics.json").read_text())
    for g in METRIC_GROUPS:
        if g not in m or any(k not in m[g] for k in METRIC_KEYS):
            errs.append(f"metrics.json group '{g}' incomplete")
    if has_unc:
        unc = m.get("uncertainty", {})
        for k in UNC_KEYS:
            if k not in unc:
                errs.append(f"metrics.json uncertainty key '{k}' missing")
    return errs
