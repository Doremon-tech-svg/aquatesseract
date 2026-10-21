"""Results inventory script. Inspects run folders without full array loads."""
import json
from pathlib import Path
import sys
import numpy as np


def inspect_run(run_dir: Path) -> str:
    lines = [f"### Run: `{run_dir.name}`", f"Path: `{run_dir}`\n"]

    # Inspect .npy files
    lines.append("| Array File | Shape | Dtype |")
    lines.append("|---|---|---|")
    npy_files = sorted(run_dir.glob("*.npy")) + sorted((run_dir / "analysis").glob("*.npy"))
    for f in npy_files:
        try:
            arr = np.load(f, mmap_mode="r")
            rel = f.relative_to(run_dir)
            lines.append(f"| `{rel}` | `{arr.shape}` | `{arr.dtype}` |")
        except Exception as e:
            lines.append(f"| `{f.name}` | ERROR | {e} |")
    lines.append("")

    # Config summary
    cfg_file = run_dir / "config.json"
    if cfg_file.exists():
        try:
            cfg = json.loads(cfg_file.read_text())
            lines.append(f"**Config:** `model={cfg.get('model')}`, `split={cfg.get('split')}`, "
                         f"`feature_set={cfg.get('feature_set')}`, `seed={cfg.get('seed')}`, "
                         f"`has_uncertainty={cfg.get('has_uncertainty', True)}`, "
                         f"`pred_std_is_placeholder={cfg.get('pred_std_is_placeholder', False)}`")
        except Exception as e:
            lines.append(f"**Config:** ERROR reading config.json: {e}")

    # Metadata summary
    meta_file = run_dir / "metadata.json"
    if meta_file.exists():
        try:
            meta = json.loads(meta_file.read_text())
            years = meta.get("years", [])
            depths = meta.get("depth_labels_m", [])
            lat = meta.get("lat", [])
            lon = meta.get("lon", [])
            y_summary = f"{len(years)} years [{years[0]}..{years[-1]}]" if years else "empty"
            d_summary = f"{len(depths)} levels [{depths[0]}..{depths[-1]}m]" if depths else "empty"
            la_summary = f"{len(lat)} items [{lat[0]}..{lat[-1]}]" if lat else "not present"
            lo_summary = f"{len(lon)} items [{lon[0]}..{lon[-1]}]" if lon else "not present"
            lines.append(f"**Metadata:** years: {y_summary}; depths: {d_summary}; lat: {la_summary}; lon: {lo_summary}; "
                         f"lat_conv: `{meta.get('latitude_convention', 'n/a')}`; lon_conv: `{meta.get('longitude_convention', 'n/a')}`; "
                         f"oxygen_units: `{meta.get('oxygen_units', 'n/a')}`")
        except Exception as e:
            lines.append(f"**Metadata:** ERROR reading metadata.json: {e}")

    # Metrics summary
    met_file = run_dir / "metrics.json"
    if met_file.exists():
        try:
            m = json.loads(met_file.read_text())
            lines.append("**Metrics:**")
            for grp in ["all", "observed", "never_observed"]:
                if grp in m:
                    lines.append(f"- `{grp}`: rmse={m[grp].get('rmse', 'n/a')}, mae={m[grp].get('mae', 'n/a')}, "
                                 f"r2={m[grp].get('r2', 'n/a')}, n={m[grp].get('n', 'n/a')}")
            if "uncertainty" in m:
                unc = m["uncertainty"]
                lines.append(f"- `uncertainty`: coverage90={unc.get('coverage90')}, "
                             f"mean_width90={unc.get('mean_width90')}, "
                             f"cov90_never_obs={unc.get('coverage90_never_observed')}")
            else:
                lines.append("- `uncertainty`: *none / stripped*")
        except Exception as e:
            lines.append(f"**Metrics:** ERROR reading metrics.json: {e}")

    lines.append("\n---\n")
    return "\n".join(lines)


def main():
    root = Path(__file__).resolve().parents[2]
    results_dir = root / "results"
    out_file = root / "docs" / "RESULTS_INVENTORY.md"

    run_dirs = []
    if results_dir.exists():
        for d in sorted(results_dir.iterdir()):
            if d.is_dir() and (d / "metadata.json").exists():
                run_dirs.append(d)
        hf = results_dir / "hybrid_fixed"
        if hf.exists():
            for d in sorted(hf.iterdir()):
                if d.is_dir() and (d / "metadata.json").exists():
                    run_dirs.append(d)

    content = ["# Results Inventory\n", f"Total runs found: {len(run_dirs)}\n\n"]
    for r in run_dirs:
        content.append(inspect_run(r))

    output = "\n".join(content)
    out_file.write_text(output)
    print(f"Wrote inventory to {out_file}")
    if "-v" in sys.argv:
        print(output)


if __name__ == "__main__":
    main()
