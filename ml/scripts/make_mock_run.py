"""Make fake run folders matching the exact real format so server/client work.
Fake numbers. Folder names start with MOCK_ and metadata.mock=true.
Supports 4 variants matching real runs:
  - hybrid_full (overconfident, coverage ~0.5)
  - hybrid_xdrop (calibrated, coverage ~0.9)
  - lstm (has_uncertainty=false, pred_std_is_placeholder=true)
  - transformer (has_uncertainty=false, pred_std_is_placeholder=true)
"""
import argparse
import json
from pathlib import Path

import numpy as np
from numpy.lib.format import open_memmap

from aquatesseract.contract import DEPTH_LEVELS_M, N_DEPTH, metrics_for

VARIANTS = {
    "hybrid_full": {
        "name": "MOCK_CESM2_omip1_spatial_hybrid_full_seed1",
        "model": "hybrid",
        "feature_set": "full",
        "has_uncertainty": True,
        "pred_std_is_placeholder": False,
        "std_scale": 0.44,  # coverage ~0.53
    },
    "hybrid_xdrop": {
        "name": "MOCK_CESM2_omip1_spatial_hybrid_xdrop_seed1",
        "model": "hybrid",
        "feature_set": "xdrop",
        "has_uncertainty": True,
        "pred_std_is_placeholder": False,
        "std_scale": 1.0,   # coverage ~0.91
        "x_drop": 0.1,
    },
    "lstm": {
        "name": "MOCK_CESM2_omip1_spatial_lstm_full_seed1",
        "model": "lstm",
        "feature_set": "full",
        "has_uncertainty": False,
        "pred_std_is_placeholder": True,
        "std_scale": 0.0,
    },
    "transformer": {
        "name": "MOCK_CESM2_omip1_spatial_transformer_full_seed1",
        "model": "transformer",
        "feature_set": "full",
        "has_uncertainty": False,
        "pred_std_is_placeholder": True,
        "std_scale": 0.0,
    },
}


def build_mock_run(variant_key: str, out_dir: Path, seed: int = 1, years: int = 10, full_size: bool = False):
    var = VARIANTS[variant_key]
    rng = np.random.default_rng(seed)

    if full_size:
        Y, D, LAT, LON = 62, N_DEPTH, 180, 360
        lat = np.linspace(-89.5, 89.5, LAT)
        lon = np.linspace(0.5, 359.5, LON)
    else:
        Y, D, LAT, LON = years, N_DEPTH, 36, 72
        lat = np.linspace(-87.5, 87.5, LAT)
        lon = np.linspace(2.5, 357.5, LON)

    la, lo = np.deg2rad(lat)[:, None], np.deg2rad(lon)[None, :]
    land = (np.sin(2 * lo) + np.cos(3 * la)) > 1.1
    bottom = (14 + 18 * np.abs(np.sin(lo + la))).astype(int)
    ocean = (~land)[None] & (np.arange(D)[:, None, None] <= bottom[None])  # (D,LAT,LON)

    depth = np.array(DEPTH_LEVELS_M, dtype=float)[None, :, None, None]

    d = out_dir / var["name"]
    d.mkdir(parents=True, exist_ok=True)

    has_unc = var["has_uncertainty"]
    is_placeholder = var["pred_std_is_placeholder"]
    std_scale = var["std_scale"]

    if full_size:
        # Stream writes using open_memmap to avoid peak RAM usage
        mm_truth = open_memmap(d / "truth.npy", mode="w+", dtype=np.float32, shape=(Y, D, LAT, LON))
        mm_pred = open_memmap(d / "pred_mean.npy", mode="w+", dtype=np.float32, shape=(Y, D, LAT, LON))
        mm_std = open_memmap(d / "pred_std.npy", mode="w+", dtype=np.float32, shape=(Y, D, LAT, LON))
        mm_obs = open_memmap(d / "observed_mask.npy", mode="w+", dtype=np.uint8, shape=(Y, D, LAT, LON))
        mm_ocean = open_memmap(d / "ocean_mask.npy", mode="w+", dtype=np.uint8, shape=(D, LAT, LON))
        mm_dens = open_memmap(d / "observation_density.npy", mode="w+", dtype=np.float32, shape=(Y, D, LAT, LON))

        mm_ocean[:] = ocean.astype(np.uint8)

        # Base ocean components
        for y in range(Y):
            yr = float(y)
            t_slice = (0.9 * np.exp(-depth[0] / 1500) + 0.1 * np.cos(la)[None] - 0.004 * yr
                       + 0.03 * np.sin(3 * lo)[None]).astype(np.float32)
            t_slice[~ocean] = np.nan
            mm_truth[y] = t_slice

            p_prob = (0.01 + 0.15 * np.exp(-(((lat - 40) / 25) ** 2)))[None, :, None]
            p_prob = p_prob * (0.3 + yr / Y) * np.exp(-depth[0] / 800)
            obs_slice = ((rng.random((D, LAT, LON)) < p_prob) & ocean).astype(np.uint8)
            mm_obs[y] = obs_slice

            # Simple density window
            dens_slice = np.roll(obs_slice, 1, axis=1) * 0.5 + obs_slice * 0.5
            dens_slice[~ocean] = 0
            mm_dens[y] = dens_slice

            sigma = (0.01 + 0.06 * (1 - np.clip(dens_slice / 0.05, 0, 1))).astype(np.float32)
            noise = rng.normal(size=(D, LAT, LON)).astype(np.float32)
            p_slice = t_slice + noise * sigma
            p_slice[~ocean] = np.nan
            mm_pred[y] = p_slice

            if has_unc:
                s_slice = (sigma * std_scale).astype(np.float32)
                s_slice[~ocean] = np.nan
            else:
                s_slice = np.full((D, LAT, LON), 0.05 if not is_placeholder else 0.0, dtype=np.float32)
                s_slice[~ocean] = np.nan
            mm_std[y] = s_slice

        del mm_truth, mm_pred, mm_std, mm_obs, mm_ocean, mm_dens

        # Load small slice for metrics computation
        sample_pred = np.load(d / "pred_mean.npy", mmap_mode="r")[:2]
        sample_truth = np.load(d / "truth.npy", mmap_mode="r")[:2]
        sample_std = np.load(d / "pred_std.npy", mmap_mode="r")[:2]
        sample_obs = np.load(d / "observed_mask.npy", mmap_mode="r")[:2]
        m = metrics_for(np.asarray(sample_pred), np.asarray(sample_truth),
                        np.asarray(sample_std), np.asarray(sample_obs))
    else:
        yr = np.arange(Y, dtype=float)[:, None, None, None]
        truth = (0.9 * np.exp(-depth / 1500) + 0.1 * np.cos(la)[None, None] - 0.004 * yr
                 + 0.03 * np.sin(3 * lo)[None, None]).astype(np.float32)
        truth = np.broadcast_to(truth, (Y, D, LAT, LON)).copy()
        truth[:, ~ocean] = np.nan

        p = (0.01 + 0.15 * np.exp(-(((lat - 40) / 25) ** 2)))[None, None, :, None]
        p = p * (0.3 + yr / Y) * np.exp(-depth / 800)
        obs = ((rng.random((Y, D, LAT, LON)) < p) & ocean[None]).astype(np.uint8)

        dens = np.zeros(obs.shape, dtype=np.float32)
        n = 0
        for dy in (-1, 0, 1):
            for dl in (-1, 0, 1):
                for dn in (-1, 0, 1):
                    dens += np.roll(obs, (dy, dl, dn), axis=(0, 2, 3))
                    n += 1
        dens /= n

        sigma = (0.01 + 0.06 * (1 - np.clip(dens / 0.05, 0, 1))).astype(np.float32)
        pred = (truth + rng.normal(size=truth.shape) * sigma).astype(np.float32)

        if has_unc:
            std = (sigma * std_scale).astype(np.float32)
        else:
            std = np.full(truth.shape, 0.05 if not is_placeholder else 0.0, dtype=np.float32)

        for arr in (pred, std, dens):
            arr[:, ~ocean] = np.nan if arr is not dens else 0

        for f, arr in [("pred_mean", pred), ("pred_std", std), ("truth", truth), ("observed_mask", obs),
                       ("ocean_mask", ocean.astype(np.uint8)), ("observation_density", dens)]:
            np.save(d / f"{f}.npy", arr)

        m = metrics_for(pred, truth, std, obs)

    if not has_unc or is_placeholder:
        m.pop("uncertainty", None)

    (d / "metrics.json").write_text(json.dumps(m, indent=2))
    years_list = list(range(1948, 1948 + Y))

    meta_dict = {
        "dataset": "CESM2_omip1",
        "split": "spatial",
        "model": var["model"],
        "feature_set": var["feature_set"],
        "seed": 1,
        "start_year": 1948,
        "years": years_list,
        "depth_labels_m": DEPTH_LEVELS_M,
        "latitude_convention": "TO_VERIFY (mock: index0 = -87.5, south to north)",
        "longitude_convention": "TO_VERIFY (mock: index0 = 2.5E, 0..360)",
        "oxygen_units": "TO_VERIFY (mock: normalised 0..1)",
        "normalization": "TO_VERIFY",
        "lat": [float(x) for x in lat],
        "lon": [float(x) for x in lon],
        "simulation_caveat": True,
        "mock": True,
        "has_uncertainty": has_unc,
        "pred_std_is_placeholder": is_placeholder,
    }
    if "x_drop" in var:
        meta_dict["x_drop"] = var["x_drop"]
    (d / "metadata.json").write_text(json.dumps(meta_dict, indent=2))

    cfg_dict = {
        "dataset": "CESM2_omip1",
        "split": "spatial",
        "model": var["model"],
        "feature_set": var["feature_set"],
        "seed": 1,
        "source": "mock",
        "note": "fake numbers for plumbing only",
        "has_uncertainty": has_unc,
        "pred_std_is_placeholder": is_placeholder,
    }
    if "x_drop" in var:
        cfg_dict["x_drop"] = var["x_drop"]
    (d / "config.json").write_text(json.dumps(cfg_dict, indent=2))

    rows = ["year,rmse,r2"]
    for i, y in enumerate(years_list[:min(len(years_list), 5)]):
        rows.append(f"{y},0.05000,0.80000")
    (d / "summary_by_year.csv").write_text("\n".join(rows) + "\n")
    print(f"wrote {d} (uncertainty={has_unc}, coverage={m.get('uncertainty', {}).get('coverage90', 'n/a')})")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="results")
    ap.add_argument("--variant", choices=list(VARIANTS.keys()) + ["all"], default="all")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--years", type=int, default=10)
    ap.add_argument("--full-size", action="store_true", help="Generate full-sized 62x33x180x360 arrays with memmap")
    a = ap.parse_args()

    out_dir = Path(a.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    targets = list(VARIANTS.keys()) if a.variant == "all" else [a.variant]
    for key in targets:
        build_mock_run(key, out_dir, seed=a.seed, years=a.years, full_size=a.full_size)


if __name__ == "__main__":
    main()
