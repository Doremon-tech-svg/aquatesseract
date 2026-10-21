import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';
import { dbReady, pool } from './db';
import { openNpy } from './npy';
import { FILES, listRunDirs } from './runs';

export interface RunCapabilities {
  uncertainty: boolean;
  density: boolean;
  analysis: string[];
  physics: boolean;
}

export interface IngestedRun {
  id: string;
  dir: string;
  dataset: string;
  split: string;
  model: string;
  feature_set: string | null;
  seed: number | null;
  source: string;
  status: 'validated' | 'invalid';
  reasons: string[];
  capabilities: RunCapabilities;
  metrics: Record<string, any> | null;
  x_drop?: number | string | null;
  do_drop?: number | string | null;
  has_uncertainty?: boolean;
}

let cache: Map<string, IngestedRun> = new Map();

function readJsonQuiet(filePath: string): any {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export function ingestRun(id: string, dir: string): IngestedRun {
  const reasons: string[] = [];

  const reqFiles = [
    'truth.npy',
    'pred_mean.npy',
    'pred_std.npy',
    'observed_mask.npy',
    'ocean_mask.npy',
    'metadata.json',
    'config.json',
    'metrics.json',
  ];

  for (const f of reqFiles) {
    if (!fs.existsSync(path.join(dir, f))) {
      reasons.push(`missing file: ${f}`);
    }
  }

  const meta = readJsonQuiet(path.join(dir, 'metadata.json')) ?? {};
  const cfg = readJsonQuiet(path.join(dir, 'config.json')) ?? {};
  const metrics = readJsonQuiet(path.join(dir, 'metrics.json'));

  if (!metrics && fs.existsSync(path.join(dir, 'metrics.json'))) {
    reasons.push('corrupt metrics.json');
  }

  // Flags can live in config.json OR metadata.json
  const hasUncertainty =
    cfg.has_uncertainty !== undefined
      ? Boolean(cfg.has_uncertainty)
      : meta.has_uncertainty !== undefined
        ? Boolean(meta.has_uncertainty)
        : true;

  const stdIsPlaceholder =
    cfg.pred_std_is_placeholder !== undefined
      ? Boolean(cfg.pred_std_is_placeholder)
      : meta.pred_std_is_placeholder !== undefined
        ? Boolean(meta.pred_std_is_placeholder)
        : false;

  const xDrop = cfg.x_drop ?? meta.x_drop ?? null;
  const doDrop = cfg.do_drop ?? meta.do_drop ?? null;

  // Analysis files
  const analysisDir = path.join(dir, 'analysis');
  const analysis: string[] = [];
  if (fs.existsSync(analysisDir) && fs.statSync(analysisDir).isDirectory()) {
    for (const f of fs.readdirSync(analysisDir)) {
      if (f.endsWith('.json')) {
        analysis.push(f.replace(/\.json$/, ''));
      }
    }
  }

  const densityFile =
    fs.existsSync(path.join(analysisDir, FILES.density)) ||
    fs.existsSync(path.join(dir, FILES.density));
  const physicsFile = fs.existsSync(path.join(dir, FILES.physics));

  const capabilities: RunCapabilities = {
    uncertainty: hasUncertainty && !stdIsPlaceholder,
    density: densityFile,
    analysis,
    physics: physicsFile,
  };

  // Cheap header checks on NPY files
  if (reasons.length === 0) {
    try {
      const truth = openNpy(path.join(dir, 'truth.npy'));
      const mean = openNpy(path.join(dir, 'pred_mean.npy'));
      const std = openNpy(path.join(dir, 'pred_std.npy'));
      const obs = openNpy(path.join(dir, 'observed_mask.npy'));
      const ocean = openNpy(path.join(dir, 'ocean_mask.npy'));

      const shape = truth.shape;
      if (shape.length !== 4) {
        reasons.push(`truth shape ${JSON.stringify(shape)} is not 4D (year, depth, lat, lon)`);
      } else {
        if (JSON.stringify(mean.shape) !== JSON.stringify(shape)) {
          reasons.push(`pred_mean shape ${JSON.stringify(mean.shape)} != truth shape ${JSON.stringify(shape)}`);
        }
        if (JSON.stringify(std.shape) !== JSON.stringify(shape)) {
          reasons.push(`pred_std shape ${JSON.stringify(std.shape)} != truth shape ${JSON.stringify(shape)}`);
        }
        if (JSON.stringify(obs.shape) !== JSON.stringify(shape)) {
          reasons.push(`observed_mask shape ${JSON.stringify(obs.shape)} != truth shape ${JSON.stringify(shape)}`);
        }
        const isOcean3D = JSON.stringify(ocean.shape) === JSON.stringify(shape.slice(1));
        const isOcean4D = JSON.stringify(ocean.shape) === JSON.stringify(shape);
        if (!isOcean3D && !isOcean4D) {
          reasons.push(`ocean_mask shape ${JSON.stringify(ocean.shape)} must be 3D or 4D`);
        }
        if (shape[1] !== 33) {
          reasons.push(`depth axis must be 33, got ${shape[1]}`);
        }
      }
    } catch (err: any) {
      reasons.push(`npy header error: ${err?.message ?? String(err)}`);
    }
  }

  const status: 'validated' | 'invalid' = reasons.length === 0 ? 'validated' : 'invalid';

  return {
    id,
    dir,
    dataset: cfg.dataset ?? meta.dataset ?? 'unknown',
    split: cfg.split ?? meta.split ?? 'unknown',
    model: cfg.model ?? meta.model ?? 'unknown',
    feature_set: cfg.feature_set ?? meta.feature_set ?? null,
    seed: typeof cfg.seed === 'number' ? cfg.seed : typeof meta.seed === 'number' ? meta.seed : null,
    source: cfg.source ?? (id.startsWith('MOCK_') ? 'mock' : 'hybrid'),
    status,
    reasons,
    capabilities,
    metrics,
    x_drop: xDrop,
    do_drop: doDrop,
    has_uncertainty: hasUncertainty,
  };
}

export async function ingestAll(): Promise<IngestedRun[]> {
  const dirs = listRunDirs();
  const runs: IngestedRun[] = [];

  for (const [id, dir] of dirs.entries()) {
    const run = ingestRun(id, dir);
    runs.push(run);
    cache.set(id, run);

    if (dbReady) {
      try {
        await pool.query(
          `INSERT INTO runs (run_id, dataset, split, model, feature_set, seed, source, status, reasons, capabilities, metrics, synced_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
           ON CONFLICT (run_id) DO UPDATE SET
             dataset = EXCLUDED.dataset,
             split = EXCLUDED.split,
             model = EXCLUDED.model,
             feature_set = EXCLUDED.feature_set,
             seed = EXCLUDED.seed,
             source = EXCLUDED.source,
             status = EXCLUDED.status,
             reasons = EXCLUDED.reasons,
             capabilities = EXCLUDED.capabilities,
             metrics = EXCLUDED.metrics,
             synced_at = EXCLUDED.synced_at`,
          [
            run.id,
            run.dataset,
            run.split,
            run.model,
            run.feature_set,
            run.seed,
            run.source,
            run.status,
            JSON.stringify(run.reasons),
            JSON.stringify(run.capabilities),
            run.metrics ? JSON.stringify(run.metrics) : null,
          ]
        );
      } catch (err) {
        console.warn(`DB upsert failed for run ${run.id}:`, err);
      }
    }
  }

  return runs;
}

export function getIngestedRuns(): IngestedRun[] {
  if (cache.size === 0) {
    const dirs = listRunDirs();
    for (const [id, dir] of dirs.entries()) {
      cache.set(id, ingestRun(id, dir));
    }
  }
  return Array.from(cache.values());
}

export function getIngestedRun(id: string): IngestedRun | undefined {
  if (!cache.has(id)) {
    getIngestedRuns();
  }
  return cache.get(id);
}

export async function verifyChecksums(): Promise<{ ok: string[]; failed: string[] }> {
  const ok: string[] = [];
  const failed: string[] = [];

  const checksumFiles: string[] = [];
  const rootChecksum = path.join(config.resultsDir, 'CHECKSUMS.txt');
  if (fs.existsSync(rootChecksum)) checksumFiles.push(rootChecksum);

  for (const [, dir] of listRunDirs().entries()) {
    const cf = path.join(dir, 'CHECKSUMS.txt');
    if (fs.existsSync(cf)) checksumFiles.push(cf);
  }

  for (const cf of checksumFiles) {
    const baseDir = path.dirname(cf);
    const lines = fs.readFileSync(cf, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const parts = trimmed.split(/\s+/);
      if (parts.length < 2) continue;
      const expectedHash = parts[0];
      let relPath = parts.slice(1).join(' ').replace(/^\*/, '');
      const fullPath = path.resolve(baseDir, relPath);

      if (!fs.existsSync(fullPath)) {
        failed.push(`${relPath}: file not found`);
        continue;
      }

      try {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(fullPath, { highWaterMark: 1024 * 1024 });
        await new Promise((resolve, reject) => {
          stream.on('data', (chunk) => hash.update(chunk));
          stream.on('end', resolve);
          stream.on('error', reject);
        });
        const actualHash = hash.digest('hex');
        if (actualHash === expectedHash) {
          ok.push(relPath);
        } else {
          failed.push(`${relPath}: checksum mismatch (expected ${expectedHash}, got ${actualHash})`);
        }
      } catch (err: any) {
        failed.push(`${relPath}: error ${err?.message ?? String(err)}`);
      }
    }
  }

  return { ok, failed };
}
