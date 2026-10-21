"""Build analysis artifacts in <run>/analysis/. Memory-safe, chunked per-year.

Outputs:
  - observation_density.npy: float32 (Y, D, LAT, LON) window density
  - thresholds.json: density & std quartile edges
  - density_bins.json: performance by density quartile
  - by_depth.json: performance by depth level
  - calibration.json: nominal vs empirical coverage (only if capabilities.uncertainty)
  - uncertainty.json: std deciles vs mean error (only if capabilities.uncertainty)
"""
import argparse
import json
from pathlib import Path
import sys

import numpy as np
from numpy.lib.format import open_memmap
import scipy.ndimage
import scipy.stats

from aquatesseract.contract import DEPTH_LEVELS_M


def _read_flags(run_dir: Path) -> dict:
    cfg, meta = {}, {}
    if (run_dir / "config.json").exists():
        try:
            cfg = json.loads((run_dir / "config.json").read_text())
        except Exception:
            pass
    if (run_dir / "metadata.json").exists():
        try:
            meta = json.loads((run_dir / "metadata.json").read_text())
        except Exception:
            pass

    has_unc = cfg.get("has_uncertainty", meta.get("has_uncertainty", True))
    is_ph = cfg.get("pred_std_is_placeholder", meta.get("pred_std_is_placeholder", False))
    return {
        "has_uncertainty": bool(has_unc) and not bool(is_ph),
    }


def compute_density_for_year(obs_y_window: np.ndarray, ocean: np.ndarray) -> np.ndarray:
    """Compute density for 1 year given obs in window of years [W, D, LAT, LON] and ocean [D, LAT, LON].

    Window: ±2 lat (edge-padded), ±2 lon (wrap), ±1 year.
    """
    # Sum over time window
    obs_sum = np.sum(obs_y_window, axis=0).astype(np.float32)  # (D, LAT, LON)
    n_years = obs_y_window.shape[0]
    ocean_sum = (ocean.astype(np.float32)) * n_years           # (D, LAT, LON)

    D, LAT, LON = ocean.shape
    out = np.zeros((D, LAT, LON), dtype=np.float32)

    # 5x5 window separable convolution: width 5 along lat (edge), width 5 along lon (wrap)
    kernel_1d = np.ones(5, dtype=np.float32)

    for d in range(D):
        # obs numerator
        # first along lat with edge padding
        num_lat = scipy.ndimage.convolve1d(obs_sum[d], kernel_1d, axis=0, mode="nearest")
        num = scipy.ndimage.convolve1d(num_lat, kernel_1d, axis=1, mode="wrap")

        # ocean denominator
        den_lat = scipy.ndimage.convolve1d(ocean_sum[d], kernel_1d, axis=0, mode="nearest")
        den = scipy.ndimage.convolve1d(den_lat, kernel_1d, axis=1, mode="wrap")

        valid = (den > 0) & ocean[d]
        dens = np.zeros_like(num)
        dens[valid] = num[valid] / den[valid]
        out[d] = dens

    return out


def build_analysis(run_dir: Path):
    print(f"Building analysis for: {run_dir.name}")
    analysis_dir = run_dir / "analysis"
    analysis_dir.mkdir(parents=True, exist_ok=True)

    flags = _read_flags(run_dir)
    has_unc = flags["has_uncertainty"]

    # Open mmap arrays
    t_mmap = np.load(run_dir / "truth.npy", mmap_mode="r")
    p_mmap = np.load(run_dir / "pred_mean.npy", mmap_mode="r")
    s_mmap = np.load(run_dir / "pred_std.npy", mmap_mode="r")
    o_mmap = np.load(run_dir / "observed_mask.npy", mmap_mode="r")
    ocean_raw = np.load(run_dir / "ocean_mask.npy", mmap_mode="r")

    shape = t_mmap.shape
    Y, D, LAT, LON = shape

    if ocean_raw.ndim == 4:
        ocean = np.asarray(ocean_raw[0]).astype(bool)
    else:
        ocean = np.asarray(ocean_raw).astype(bool)

    # 1. Compute observation density array
    density_path = analysis_dir / "observation_density.npy"
    dens_mmap = open_memmap(density_path, mode="w+", dtype=np.float32, shape=(Y, D, LAT, LON))

    for y in range(Y):
        y_min = max(0, y - 1)
        y_max = min(Y, y + 2)
        obs_window = np.asarray(o_mmap[y_min:y_max])
        dens_mmap[y] = compute_density_for_year(obs_window, ocean)

    dens_mmap.flush()

    # 2. Sample 1% of ocean cells (seeded 0) across all years for thresholds
    rng = np.random.default_rng(0)
    ocean_indices = np.argwhere(ocean)  # (N_ocean, 3) -> (d, lat, lon)
    n_ocean_per_year = len(ocean_indices)
    sample_size_per_year = max(1, int(n_ocean_per_year * 0.01))

    sampled_dens = []
    sampled_std = []

    for y in range(Y):
        chosen = rng.choice(n_ocean_per_year, size=sample_size_per_year, replace=False)
        pts = ocean_indices[chosen]
        d_idx, la_idx, lo_idx = pts[:, 0], pts[:, 1], pts[:, 2]

        d_slice = dens_mmap[y, d_idx, la_idx, lo_idx]
        sampled_dens.append(d_slice)

        if has_unc:
            s_slice = s_mmap[y, d_idx, la_idx, lo_idx]
            sampled_std.append(s_slice)

    all_sampled_dens = np.concatenate(sampled_dens)
    density_quartiles = [float(x) for x in np.percentile(all_sampled_dens, [0, 25, 50, 75, 100])]

    if has_unc:
        all_sampled_std = np.concatenate(sampled_std)
        std_quartiles = [float(x) for x in np.percentile(all_sampled_std, [0, 25, 50, 75, 100])]
    else:
        std_quartiles = None

    thresholds = {
        "density_quartiles": density_quartiles,
        "std_quartiles": std_quartiles,
    }
    (analysis_dir / "thresholds.json").write_text(json.dumps(thresholds, indent=2))

    # 3. Determine never-observed mask on ocean: cells observed 0 times across all years
    ever_observed = np.zeros((D, LAT, LON), dtype=bool)
    for y in range(Y):
        ever_observed |= (np.asarray(o_mmap[y]) > 0)
    never_observed = ocean & (~ever_observed)

    # 4. Stream over years to accumulate density bins and by_depth statistics
    bin_names = ["very_sparse", "sparse", "medium", "well_observed"]
    q0, q25, q50, q75, q100 = density_quartiles

    # Accumulators for density bins
    bin_stats = {
        b: {"n": 0, "sq_err": 0.0, "abs_err": 0.0, "t_sum": 0.0, "t_sq_sum": 0.0,
            "std_sum": 0.0, "cov_count": 0, "never_obs_count": 0}
        for b in bin_names
    }

    # Accumulators for depth levels
    depth_stats = [
        {
            "all": {"n": 0, "sq_err": 0.0, "abs_err": 0.0, "t_sum": 0.0, "t_sq_sum": 0.0},
            "never_observed": {"n": 0, "sq_err": 0.0, "abs_err": 0.0, "t_sum": 0.0, "t_sq_sum": 0.0},
        }
        for _ in range(D)
    ]

    # Calibration accumulators if has_unc
    nominal_levels = [0.5, 0.8, 0.9, 0.95]
    z_scores = [float(scipy.stats.norm.ppf((1.0 + a) / 2.0)) for a in nominal_levels]
    cal_counts = {
        grp: [0 for _ in nominal_levels]
        for grp in ["all", "observed", "never_observed"]
    }
    cal_totals = {"all": 0, "observed": 0, "never_observed": 0}

    # Uncertainty deciles if has_unc
    if has_unc and std_quartiles is not None:
        decile_edges = np.percentile(all_sampled_std, np.linspace(0, 100, 11))
    else:
        decile_edges = None

    decile_stats = [
        {"n": 0, "abs_err_sum": 0.0, "sq_err_sum": 0.0, "std_sum": 0.0}
        for _ in range(10)
    ]

    for y in range(Y):
        t_y = np.asarray(t_mmap[y])
        p_y = np.asarray(p_mmap[y])
        o_y = np.asarray(o_mmap[y]) > 0
        d_y = np.asarray(dens_mmap[y])
        err_y = p_y - t_y
        abs_err_y = np.abs(err_y)
        sq_err_y = err_y ** 2

        if has_unc:
            s_y = np.asarray(s_mmap[y])

        # Bin masks
        b_masks = {
            "very_sparse": ocean & (d_y <= q25),
            "sparse": ocean & (d_y > q25) & (d_y <= q50),
            "medium": ocean & (d_y > q50) & (d_y <= q75),
            "well_observed": ocean & (d_y > q75),
        }

        for b, m in b_masks.items():
            cnt = int(np.count_nonzero(m))
            if cnt > 0:
                bin_stats[b]["n"] += cnt
                bin_stats[b]["sq_err"] += float(np.sum(sq_err_y[m]))
                bin_stats[b]["abs_err"] += float(np.sum(abs_err_y[m]))
                bin_stats[b]["t_sum"] += float(np.sum(t_y[m]))
                bin_stats[b]["t_sq_sum"] += float(np.sum((t_y[m]) ** 2))
                bin_stats[b]["never_obs_count"] += int(np.count_nonzero(m & never_observed))
                if has_unc:
                    bin_stats[b]["std_sum"] += float(np.sum(s_y[m]))
                    cov = abs_err_y[m] <= (1.645 * s_y[m])
                    bin_stats[b]["cov_count"] += int(np.count_nonzero(cov))

        # Depth stats
        for d in range(D):
            oc_d = ocean[d]
            cnt_all = int(np.count_nonzero(oc_d))
            if cnt_all > 0:
                depth_stats[d]["all"]["n"] += cnt_all
                depth_stats[d]["all"]["sq_err"] += float(np.sum(sq_err_y[d, oc_d]))
                depth_stats[d]["all"]["abs_err"] += float(np.sum(abs_err_y[d, oc_d]))
                depth_stats[d]["all"]["t_sum"] += float(np.sum(t_y[d, oc_d]))
                depth_stats[d]["all"]["t_sq_sum"] += float(np.sum((t_y[d, oc_d]) ** 2))

            nev_d = never_observed[d]
            cnt_nev = int(np.count_nonzero(nev_d))
            if cnt_nev > 0:
                depth_stats[d]["never_observed"]["n"] += cnt_nev
                depth_stats[d]["never_observed"]["sq_err"] += float(np.sum(sq_err_y[d, nev_d]))
                depth_stats[d]["never_observed"]["abs_err"] += float(np.sum(abs_err_y[d, nev_d]))
                depth_stats[d]["never_observed"]["t_sum"] += float(np.sum(t_y[d, nev_d]))
                depth_stats[d]["never_observed"]["t_sq_sum"] += float(np.sum((t_y[d, nev_d]) ** 2))

        # Calibration stats
        if has_unc:
            obs_cells = ocean & o_y
            nev_cells = ocean & (~o_y)

            cal_totals["all"] += int(np.count_nonzero(ocean))
            cal_totals["observed"] += int(np.count_nonzero(obs_cells))
            cal_totals["never_observed"] += int(np.count_nonzero(nev_cells))

            for idx, z in enumerate(z_scores):
                bound = z * s_y
                cal_counts["all"][idx] += int(np.count_nonzero(ocean & (abs_err_y <= bound)))
                cal_counts["observed"][idx] += int(np.count_nonzero(obs_cells & (abs_err_y <= bound)))
                cal_counts["never_observed"][idx] += int(np.count_nonzero(nev_cells & (abs_err_y <= bound)))

            if decile_edges is not None:
                for k in range(10):
                    low, high = decile_edges[k], decile_edges[k + 1]
                    d_mask = ocean & (s_y >= low) & (s_y <= high if k == 9 else s_y < high)
                    d_cnt = int(np.count_nonzero(d_mask))
                    if d_cnt > 0:
                        decile_stats[k]["n"] += d_cnt
                        decile_stats[k]["abs_err_sum"] += float(np.sum(abs_err_y[d_mask]))
                        decile_stats[k]["sq_err_sum"] += float(np.sum(sq_err_y[d_mask]))
                        decile_stats[k]["std_sum"] += float(np.sum(s_y[d_mask]))

    # Finalize density_bins.json
    density_bins_out = {}
    for b in bin_names:
        st = bin_stats[b]
        n = st["n"]
        if n > 0:
            rmse = float(np.sqrt(st["sq_err"] / n))
            mae = float(st["abs_err"] / n)
            var_t = (st["t_sq_sum"] / n) - (st["t_sum"] / n) ** 2
            r2 = float(1.0 - (st["sq_err"] / n) / max(1e-12, var_t)) if var_t > 0 else 0.0
            mean_std = float(st["std_sum"] / n) if has_unc else None
            cov90 = float(st["cov_count"] / n) if has_unc else None
            frac_never = float(st["never_obs_count"] / n)
        else:
            rmse, mae, r2, mean_std, cov90, frac_never = None, None, None, None, None, None

        density_bins_out[b] = {
            "n": n,
            "rmse": rmse,
            "mae": mae,
            "r2": r2,
            "mean_std": mean_std,
            "coverage90": cov90,
            "frac_never_observed": frac_never,
        }

    (analysis_dir / "density_bins.json").write_text(json.dumps(density_bins_out, indent=2))

    # Finalize by_depth.json
    by_depth_out = []
    for d in range(D):
        entry = {"depth_idx": d, "depth_m": DEPTH_LEVELS_M[d]}
        for grp in ["all", "never_observed"]:
            st = depth_stats[d][grp]
            n = st["n"]
            if n > 0:
                rmse = float(np.sqrt(st["sq_err"] / n))
                mae = float(st["abs_err"] / n)
                var_t = (st["t_sq_sum"] / n) - (st["t_sum"] / n) ** 2
                r2 = float(1.0 - (st["sq_err"] / n) / max(1e-12, var_t)) if var_t > 0 else 0.0
            else:
                rmse, mae, r2 = None, None, None
            entry[grp] = {"rmse": rmse, "mae": mae, "r2": r2, "n": n}
        by_depth_out.append(entry)

    (analysis_dir / "by_depth.json").write_text(json.dumps(by_depth_out, indent=2))

    # Finalize calibration.json and uncertainty.json
    if has_unc:
        cal_out = {
            "nominal": nominal_levels,
            "z_scores": [round(z, 5) for z in z_scores],
            "all": [round(cal_counts["all"][i] / max(1, cal_totals["all"]), 5) for i in range(len(nominal_levels))],
            "observed": [round(cal_counts["observed"][i] / max(1, cal_totals["observed"]), 5) for i in range(len(nominal_levels))],
            "never_observed": [round(cal_counts["never_observed"][i] / max(1, cal_totals["never_observed"]), 5) for i in range(len(nominal_levels))],
        }
        (analysis_dir / "calibration.json").write_text(json.dumps(cal_out, indent=2))
        print(f"  Calibration at nominal 0.9: all={cal_out['all'][2]}, never_obs={cal_out['never_observed'][2]}")

        unc_out = []
        if decile_edges is not None:
            for k in range(10):
                st = decile_stats[k]
                n = st["n"]
                unc_out.append({
                    "decile": k,
                    "std_min": float(decile_edges[k]),
                    "std_max": float(decile_edges[k + 1]),
                    "n": n,
                    "mean_std": float(st["std_sum"] / n) if n > 0 else None,
                    "mean_abs_error": float(st["abs_err_sum"] / n) if n > 0 else None,
                    "rmse": float(np.sqrt(st["sq_err_sum"] / n)) if n > 0 else None,
                })
        (analysis_dir / "uncertainty.json").write_text(json.dumps(unc_out, indent=2))

    print(f"Done analysis for {run_dir.name}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("runs", nargs="+", help="Paths to run folders")
    args = ap.parse_args()

    for r in args.runs:
        path = Path(r)
        if not path.is_dir() or not (path / "metadata.json").exists():
            print(f"Skipping non-run: {path}", file=sys.stderr)
            continue
        build_analysis(path)


if __name__ == "__main__":
    main()
