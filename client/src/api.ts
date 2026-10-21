const BASE = '/api';

export interface RunCapabilities {
  uncertainty: boolean;
  density: boolean;
  analysis: string[];
  physics: boolean;
}

export interface RunItem {
  id: string;
  status: 'validated' | 'invalid';
  split: string;
  model: string;
  feature_set: string | null;
  seed: number | null;
  capabilities: RunCapabilities;
}

export interface MapData {
  run: string;
  layer: string;
  year: number;
  depth_idx: number;
  depth_m: number;
  shape: [number, number];
  stride: number;
  min: number | null;
  max: number | null;
  values: (number | null)[];
  oxygen_units: string;
  simulation_caveat: boolean;
}

export interface Metadata {
  years: number[];
  depth_labels_m: number[];
  oxygen_units: string;
  caveats: string[];
  dataset: string;
  split: string;
  model: string;
  layers: string[];
  shape: number[];
  capabilities?: RunCapabilities;
  simulation_caveat: boolean;
  x_drop?: number | string | null;
  do_drop?: number | string | null;
}

export interface CompRow {
  source: 'published' | 'reproduced' | 'hybrid' | 'mock';
  dataset: string;
  split: string;
  model: string;
  feature_set: string | null;
  seed: number | null;
  x_drop?: number | string | null;
  do_drop?: number | string | null;
  has_uncertainty?: boolean;
  rmse: number | null;
  rmse_all: number | null;
  rmse_never_observed: number | null;
  rmse_observed: number | null;
  r2: number | null;
  coverage90: number | null;
  reference?: string;
  scope: string;
  note?: string;
  run?: string;
}

export interface CalibrationData {
  nominal: number[];
  z_scores: number[];
  all: number[];
  observed: number[];
  never_observed: number[];
}

export interface DensityBin {
  n: number;
  rmse: number | null;
  mae: number | null;
  r2: number | null;
  mean_std: number | null;
  coverage90: number | null;
  frac_never_observed: number | null;
}

export interface DepthLevelStat {
  depth_idx: number;
  depth_m: number;
  all: { rmse: number | null; mae: number | null; r2: number | null; n: number };
  never_observed: { rmse: number | null; mae: number | null; r2: number | null; n: number };
}

async function get<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
  const res = await fetch(`${BASE}/${path}${qs ? `?${qs}` : ''}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
  return body as T;
}

export const api = {
  runs: () => get<{ runs: RunItem[] }>('runs'),
  metadata: (run: string) => get<Metadata>('metadata', { run }),
  metrics: (run: string) => get<Record<string, any>>('metrics', { run }),
  map: (run: string, layer: string, year: number, depth: number, stride = 1) =>
    get<MapData>('map', { run, layer, year, depth, stride }),
  comparison: () => get<{ rows: CompRow[] }>('comparison'),
  reliability: <T = any>(kind: string, run: string) => get<T>(`reliability/${kind}`, { run }),
};
