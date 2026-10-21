import json
import subprocess
import sys
from pathlib import Path

import numpy as np

from aquatesseract.contract import metrics_for, metrics_streaming, validate_run

ROOT = Path(__file__).resolve().parents[2]


def test_metrics_known_values():
    t = np.array([1, 2, 3, np.nan], dtype=np.float32)
    p = np.array([1, 2, 4, 9], dtype=np.float32)
    m = metrics_for(p, t, np.full(4, 1.0, dtype=np.float32), np.array([1, 0, 0, 0]))
    assert m["all"]["n"] == 3 and m["observed"]["n"] == 1
    assert abs(m["all"]["rmse"] - (1 / 3) ** 0.5) < 1e-9


def test_mock_run_obeys_contract(tmp_path):
    subprocess.run([sys.executable, str(ROOT / "ml/scripts/make_mock_run.py"), "--out",
                    str(tmp_path), "--years", "4"], check=True)
    runs = list(tmp_path.glob("MOCK_*"))
    assert runs and validate_run(runs[0]) == []


def test_zero_on_land_is_rejected(tmp_path):
    subprocess.run([sys.executable, str(ROOT / "ml/scripts/make_mock_run.py"), "--out",
                    str(tmp_path), "--years", "3"], check=True)
    run = next(tmp_path.glob("MOCK_*"))
    t = np.load(run / "truth.npy")
    t[np.isnan(t)] = 0.0  # the classic NaN-vs-zero bug
    np.save(run / "truth.npy", t)
    assert any("NaN" in e or "land" in e.lower() for e in validate_run(run))


def test_has_uncertainty_false_passes(tmp_path):
    """Run with has_uncertainty=false must validate without std>0 check."""
    subprocess.run([sys.executable, str(ROOT / "ml/scripts/make_mock_run.py"), "--out",
                    str(tmp_path), "--years", "3"], check=True)
    run = next(tmp_path.glob("MOCK_*"))
    # Overwrite pred_std with zeros (placeholder) and flag config
    cfg = json.loads((run / "config.json").read_text())
    cfg["has_uncertainty"] = False
    cfg["pred_std_is_placeholder"] = True
    (run / "config.json").write_text(json.dumps(cfg))
    std = np.load(run / "pred_std.npy")
    std[:] = 0.0
    np.save(run / "pred_std.npy", std)
    errs = validate_run(run)
    assert errs == [], f"Expected no errors but got: {errs}"


def test_bool_mask_accepted(tmp_path):
    """observed_mask with dtype bool must not be rejected."""
    subprocess.run([sys.executable, str(ROOT / "ml/scripts/make_mock_run.py"), "--out",
                    str(tmp_path), "--years", "3"], check=True)
    run = next(tmp_path.glob("MOCK_*"))
    obs = np.load(run / "observed_mask.npy")
    np.save(run / "observed_mask.npy", obs.astype(bool))
    errs = validate_run(run)
    assert errs == [], f"Expected no errors for bool mask but got: {errs}"


def test_metrics_streaming_matches_metrics_for(tmp_path):
    """metrics_streaming and metrics_for must agree on a small mock run."""
    subprocess.run([sys.executable, str(ROOT / "ml/scripts/make_mock_run.py"), "--out",
                    str(tmp_path), "--years", "4"], check=True)
    run = next(tmp_path.glob("MOCK_*"))
    ms = metrics_streaming(run)
    for g in ["all", "observed", "never_observed"]:
        assert g in ms
        assert ms[g]["n"] > 0
    # uncertainty group should be present (mock run has_uncertainty=True by default)
    assert "uncertainty" in ms

