# Results Inventory

Total runs found: 5


### Run: `MOCK_CESM2_omip1_spatial_hybrid_full_seed1`
Path: `/home/divyank-richhariya/INNOTECH/aquatesseract/results/MOCK_CESM2_omip1_spatial_hybrid_full_seed1`

| Array File | Shape | Dtype |
|---|---|---|
| `observation_density.npy` | `(10, 33, 36, 72)` | `float32` |
| `observed_mask.npy` | `(10, 33, 36, 72)` | `uint8` |
| `ocean_mask.npy` | `(33, 36, 72)` | `uint8` |
| `pred_mean.npy` | `(10, 33, 36, 72)` | `float32` |
| `pred_std.npy` | `(10, 33, 36, 72)` | `float32` |
| `truth.npy` | `(10, 33, 36, 72)` | `float32` |
| `analysis/observation_density.npy` | `(10, 33, 36, 72)` | `float32` |

**Config:** `model=hybrid`, `split=spatial`, `feature_set=full`, `seed=1`, `has_uncertainty=True`, `pred_std_is_placeholder=False`
**Metadata:** years: 10 years [1948..1957]; depths: 33 levels [0..5500m]; lat: 36 items [-87.5..87.5]; lon: 72 items [2.5..357.5]; lat_conv: `TO_VERIFY (mock: index0 = -87.5, south to north)`; lon_conv: `TO_VERIFY (mock: index0 = 2.5E, 0..360)`; oxygen_units: `TO_VERIFY (mock: normalised 0..1)`
**Metrics:**
- `all`: rmse=0.059746835899307016, mae=0.04377652976832958, r2=0.945713774570815, n=601130
- `observed`: rmse=0.01632026083502534, mae=0.011658576979424108, r2=0.9895166228966354, n=12137
- `never_observed`: rmse=0.06031379667146405, mae=0.04443836376805275, r2=0.9449420156208757, n=588993
- `uncertainty`: coverage90=0.5324239349225625, mean_width90=0.07966764271259308, cov90_never_obs=0.5324188912262116

---

### Run: `MOCK_CESM2_omip1_spatial_hybrid_xdrop_seed1`
Path: `/home/divyank-richhariya/INNOTECH/aquatesseract/results/MOCK_CESM2_omip1_spatial_hybrid_xdrop_seed1`

| Array File | Shape | Dtype |
|---|---|---|
| `observation_density.npy` | `(10, 33, 36, 72)` | `float32` |
| `observed_mask.npy` | `(10, 33, 36, 72)` | `uint8` |
| `ocean_mask.npy` | `(33, 36, 72)` | `uint8` |
| `pred_mean.npy` | `(10, 33, 36, 72)` | `float32` |
| `pred_std.npy` | `(10, 33, 36, 72)` | `float32` |
| `truth.npy` | `(10, 33, 36, 72)` | `float32` |
| `analysis/observation_density.npy` | `(10, 33, 36, 72)` | `float32` |

**Config:** `model=hybrid`, `split=spatial`, `feature_set=xdrop`, `seed=1`, `has_uncertainty=True`, `pred_std_is_placeholder=False`
**Metadata:** years: 10 years [1948..1957]; depths: 33 levels [0..5500m]; lat: 36 items [-87.5..87.5]; lon: 72 items [2.5..357.5]; lat_conv: `TO_VERIFY (mock: index0 = -87.5, south to north)`; lon_conv: `TO_VERIFY (mock: index0 = 2.5E, 0..360)`; oxygen_units: `TO_VERIFY (mock: normalised 0..1)`
**Metrics:**
- `all`: rmse=0.059746835899307016, mae=0.04377652976832958, r2=0.945713774570815, n=601130
- `observed`: rmse=0.01632026083502534, mae=0.011658576979424108, r2=0.9895166228966354, n=12137
- `never_observed`: rmse=0.06031379667146405, mae=0.04443836376805275, r2=0.9449420156208757, n=588993
- `uncertainty`: coverage90=0.9004208740205946, mean_width90=0.18106283247470856, cov90_never_obs=0.9005590898363818

---

### Run: `MOCK_CESM2_omip1_spatial_lstm_full_seed1`
Path: `/home/divyank-richhariya/INNOTECH/aquatesseract/results/MOCK_CESM2_omip1_spatial_lstm_full_seed1`

| Array File | Shape | Dtype |
|---|---|---|
| `observation_density.npy` | `(10, 33, 36, 72)` | `float32` |
| `observed_mask.npy` | `(10, 33, 36, 72)` | `uint8` |
| `ocean_mask.npy` | `(33, 36, 72)` | `uint8` |
| `pred_mean.npy` | `(10, 33, 36, 72)` | `float32` |
| `pred_std.npy` | `(10, 33, 36, 72)` | `float32` |
| `truth.npy` | `(10, 33, 36, 72)` | `float32` |
| `analysis/observation_density.npy` | `(10, 33, 36, 72)` | `float32` |

**Config:** `model=lstm`, `split=spatial`, `feature_set=full`, `seed=1`, `has_uncertainty=False`, `pred_std_is_placeholder=True`
**Metadata:** years: 10 years [1948..1957]; depths: 33 levels [0..5500m]; lat: 36 items [-87.5..87.5]; lon: 72 items [2.5..357.5]; lat_conv: `TO_VERIFY (mock: index0 = -87.5, south to north)`; lon_conv: `TO_VERIFY (mock: index0 = 2.5E, 0..360)`; oxygen_units: `TO_VERIFY (mock: normalised 0..1)`
**Metrics:**
- `all`: rmse=0.059746835899307016, mae=0.04377652976832958, r2=0.945713774570815, n=601130
- `observed`: rmse=0.01632026083502534, mae=0.011658576979424108, r2=0.9895166228966354, n=12137
- `never_observed`: rmse=0.06031379667146405, mae=0.04443836376805275, r2=0.9449420156208757, n=588993
- `uncertainty`: *none / stripped*

---

### Run: `MOCK_CESM2_omip1_spatial_transformer_full_seed1`
Path: `/home/divyank-richhariya/INNOTECH/aquatesseract/results/MOCK_CESM2_omip1_spatial_transformer_full_seed1`

| Array File | Shape | Dtype |
|---|---|---|
| `observation_density.npy` | `(10, 33, 36, 72)` | `float32` |
| `observed_mask.npy` | `(10, 33, 36, 72)` | `uint8` |
| `ocean_mask.npy` | `(33, 36, 72)` | `uint8` |
| `pred_mean.npy` | `(10, 33, 36, 72)` | `float32` |
| `pred_std.npy` | `(10, 33, 36, 72)` | `float32` |
| `truth.npy` | `(10, 33, 36, 72)` | `float32` |
| `analysis/observation_density.npy` | `(10, 33, 36, 72)` | `float32` |

**Config:** `model=transformer`, `split=spatial`, `feature_set=full`, `seed=1`, `has_uncertainty=False`, `pred_std_is_placeholder=True`
**Metadata:** years: 10 years [1948..1957]; depths: 33 levels [0..5500m]; lat: 36 items [-87.5..87.5]; lon: 72 items [2.5..357.5]; lat_conv: `TO_VERIFY (mock: index0 = -87.5, south to north)`; lon_conv: `TO_VERIFY (mock: index0 = 2.5E, 0..360)`; oxygen_units: `TO_VERIFY (mock: normalised 0..1)`
**Metrics:**
- `all`: rmse=0.059746835899307016, mae=0.04377652976832958, r2=0.945713774570815, n=601130
- `observed`: rmse=0.01632026083502534, mae=0.011658576979424108, r2=0.9895166228966354, n=12137
- `never_observed`: rmse=0.06031379667146405, mae=0.04443836376805275, r2=0.9449420156208757, n=588993
- `uncertainty`: *none / stripped*

---

### Run: `MOCK_CESM2_omip1_temporal_hybrid_base_seed0`
Path: `/home/divyank-richhariya/INNOTECH/aquatesseract/results/MOCK_CESM2_omip1_temporal_hybrid_base_seed0`

| Array File | Shape | Dtype |
|---|---|---|
| `observation_density.npy` | `(10, 33, 36, 72)` | `float32` |
| `observed_mask.npy` | `(10, 33, 36, 72)` | `uint8` |
| `ocean_mask.npy` | `(33, 36, 72)` | `uint8` |
| `pred_mean.npy` | `(10, 33, 36, 72)` | `float32` |
| `pred_std.npy` | `(10, 33, 36, 72)` | `float32` |
| `truth.npy` | `(10, 33, 36, 72)` | `float32` |
| `analysis/observation_density.npy` | `(10, 33, 36, 72)` | `float32` |

**Config:** `model=hybrid`, `split=temporal`, `feature_set=base`, `seed=0`, `has_uncertainty=True`, `pred_std_is_placeholder=False`
**Metadata:** years: 10 years [1948..1957]; depths: 33 levels [0..5500m]; lat: 36 items [-87.5..87.5]; lon: 72 items [2.5..357.5]; lat_conv: `TO_VERIFY (mock: index0 = -87.5, south to north)`; lon_conv: `TO_VERIFY (mock: index0 = 2.5E, 0..360)`; oxygen_units: `TO_VERIFY (mock: normalised 0..1)`
**Metrics:**
- `all`: rmse=0.059697960138451966, mae=0.043708697503761086, r2=0.945802560642379, n=601130
- `observed`: rmse=0.01658513765573671, mae=0.011841295548752781, r2=0.9890493044332652, n=12105
- `never_observed`: rmse=0.060261379511993424, mae=0.044363601626107974, r2=0.9450424954076977, n=589025
- `uncertainty`: coverage90=0.8620248531931529, mean_width90=0.16264598071575165, cov90_never_obs=0.8620432069946098

---
