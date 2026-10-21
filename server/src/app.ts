import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import { config } from './config';
import { dbAlive, dbReady, pool } from './db';
import { HttpError } from './errors';
import { getIngestedRun, getIngestedRuns, ingestAll, verifyChecksums } from './ingest';
import { openNpy, readAt, readBlock } from './npy';
import { arr, listRuns, readJson, runDir } from './runs';

const Z90 = 1.645;
const nn = (x: number) => (Number.isNaN(x) ? null : Number(x.toFixed(5)));

function int(q: Request['query'], name: string, min: number, max: number): number {
  const v = Number(q[name]);
  if (q[name] === undefined || !Number.isInteger(v) || v < min || v > max)
    throw new HttpError(400, 'bad_param', `"${name}" must be an integer in [${min}, ${max}]`);
  return v;
}

const MAP_LAYERS = ['truth', 'prediction', 'uncertainty', 'error', 'observed', 'density'] as const;
type MapLayer = (typeof MAP_LAYERS)[number];

function setCaching(req: Request, res: Response, filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    const etag = `"${stat.mtimeMs.toString(36)}-${stat.size.toString(36)}"`;
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('ETag', etag);
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return true;
    }
  } catch {
    // If stat fails, continue without caching headers
  }
  return false;
}

function plane(dir: string, layer: MapLayer, yi: number | null, di: number): Float64Array {
  const lead = (a: { shape: number[] }) => (a.shape.length === 4 ? [yi as number, di] : [di]);
  if (layer === 'error') {
    const p = arr(dir, 'prediction')!,
      t = arr(dir, 'truth')!;
    const a = readBlock(p, lead(p)),
      b = readBlock(t, lead(t));
    return a.map((v, i) => v - b[i]);
  }
  const a = arr(dir, layer as 'truth' | 'prediction' | 'uncertainty' | 'observed' | 'density')!;
  return readBlock(a, lead(a));
}

function oceanPlane(dir: string, di: number): Float64Array {
  const ocean = arr(dir, 'ocean')!;
  const lead = ocean.shape.length === 4 ? [0, di] : [di];
  return readBlock(ocean, lead);
}

function mapResponse(req: Request, res: Response, layer: MapLayer) {
  const runId = String(req.query.run);
  const dir = runDir(req.query.run);
  const runInfo = getIngestedRun(runId);

  if (layer === 'uncertainty' && runInfo && !runInfo.capabilities.uncertainty) {
    throw new HttpError(404, 'not_available', 'uncertainty not available for this run');
  }

  const metaPath = path.join(dir, 'metadata.json');
  if (setCaching(req, res, metaPath)) return;

  const meta = readJson(dir, 'metadata.json');
  const years: number[] = meta.years;
  const year = int(req.query, 'year', years[0], years[years.length - 1]);
  const yi = years.indexOf(year);
  const di = int(req.query, 'depth', 0, meta.depth_labels_m.length - 1);

  const ref = arr(dir, 'truth')!;
  const [, , nlat, nlon] = ref.shape;

  // Stride default: 2 if LAT * LON > 20000, else 1
  let stride = 1;
  if (req.query.stride !== undefined) {
    stride = int(req.query, 'stride', 1, 16);
  } else if (nlat * nlon > 20000) {
    stride = 2;
  }

  const vals = plane(dir, layer, yi, di);
  const ocean = oceanPlane(dir, di);
  const out: (number | null)[] = [];
  let min = Infinity,
    max = -Infinity;
  const rows = Math.ceil(nlat / stride),
    cols = Math.ceil(nlon / stride);

  for (let r = 0; r < nlat; r += stride) {
    for (let c = 0; c < nlon; c += stride) {
      const k = r * nlon + c;
      const v = ocean[k] === 0 ? NaN : vals[k];
      if (Number.isFinite(v)) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
      out.push(nn(v));
    }
  }

  res.json({
    run: req.query.run,
    layer,
    year,
    depth_idx: di,
    depth_m: meta.depth_labels_m[di],
    shape: [rows, cols],
    stride,
    min: nn(min),
    max: nn(max),
    oxygen_units: meta.oxygen_units,
    simulation_caveat: true,
    values: out,
  });
}

function cellCheck(req: Request, dir: string, nd: number, nlat: number, nlon: number) {
  const lat = int(req.query, 'lat', 0, nlat - 1),
    lon = int(req.query, 'lon', 0, nlon - 1);
  const ocean = arr(dir, 'ocean')!;
  const bad = (di: number) => {
    const coords = ocean.shape.length === 4 ? [0, di, lat, lon] : [di, lat, lon];
    return readAt(ocean, coords) === 0;
  };
  return { lat, lon, bad, nd };
}

export function createApp() {
  const app = express();
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json());

  app.get('/health', async (_q, res) =>
    res.json({
      status: 'ok',
      db: await dbAlive(),
      runs: listRuns().length,
      results_dir: config.resultsDir,
    })
  );

  app.get('/runs', (req, res) => {
    const showAll = req.query.all === '1';
    const onlyIds = req.query.ids === '1';
    let runs = getIngestedRuns();
    if (!showAll) {
      runs = runs.filter((r) => r.status === 'validated');
    }
    if (onlyIds) {
      return res.json({ runs: runs.map((r) => r.id) });
    }
    res.json({
      runs: runs.map((r) => ({
        id: r.id,
        status: r.status,
        split: r.split,
        model: r.model,
        feature_set: r.feature_set,
        seed: r.seed,
        capabilities: r.capabilities,
      })),
    });
  });

  app.get('/metadata', (req, res) => {
    const runId = String(req.query.run);
    const dir = runDir(req.query.run);
    const metaPath = path.join(dir, 'metadata.json');
    if (setCaching(req, res, metaPath)) return;

    const runInfo = getIngestedRun(runId);
    const grid = arr(dir, 'truth')!.shape;
    res.json({
      ...readJson(dir, 'metadata.json'),
      config: readJson(dir, 'config.json'),
      capabilities: runInfo?.capabilities,
      status: runInfo?.status,
      reasons: runInfo?.reasons,
      array_order: ['year', 'depth', 'lat', 'lon'],
      shape: grid,
      layers: [...MAP_LAYERS],
      simulation_caveat: true,
      caveats: [
        'Simulation is not the real ocean.',
        'Predictions are not new measurements.',
        'Real data defines the sampling pattern.',
        'Precomputed results, not live inference.',
      ],
    });
  });

  app.get('/metrics', (req, res) => {
    const runId = String(req.query.run);
    const dir = runDir(req.query.run);
    const metricsPath = path.join(dir, 'metrics.json');
    if (setCaching(req, res, metricsPath)) return;

    const runInfo = getIngestedRun(runId);
    const m = readJson(dir, 'metrics.json');
    if (runInfo && !runInfo.capabilities.uncertainty) {
      delete m.uncertainty;
    }
    res.json(m);
  });

  app.get('/comparison', async (_q, res, next) => {
    try {
      const rows: Record<string, unknown>[] = [];
      if (dbReady) {
        const { rows: pub } = await pool.query('SELECT * FROM published_results ORDER BY dataset, rmse');
        for (const p of pub) {
          rows.push({
            source: 'published',
            dataset: p.dataset,
            split: 'temporal',
            model: p.model,
            feature_set: null,
            seed: null,
            x_drop: null,
            do_drop: null,
            has_uncertainty: false,
            rmse: p.rmse,
            rmse_all: null,
            rmse_never_observed: p.rmse,
            rmse_observed: null,
            r2: p.r2,
            coverage90: null,
            reference: p.reference,
            scope: 'as reported in paper',
            note: 'different protocol, not comparable to spatial runs',
          });
        }
      }
      for (const runInfo of getIngestedRuns()) {
        if (runInfo.status === 'invalid') continue;
        const dir = runInfo.dir;
        const cfg = readJson(dir, 'config.json'),
          m = readJson(dir, 'metrics.json');
        const hasUnc = runInfo.capabilities.uncertainty;

        rows.push({
          source: cfg.source ?? (runInfo.id.startsWith('MOCK_') ? 'mock' : 'hybrid'),
          run: runInfo.id,
          dataset: cfg.dataset,
          split: cfg.split,
          model: cfg.model,
          feature_set: cfg.feature_set,
          seed: cfg.seed,
          x_drop: runInfo.x_drop,
          do_drop: runInfo.do_drop,
          has_uncertainty: hasUnc,
          rmse: m.never_observed?.rmse ?? null,
          mae: m.never_observed?.mae ?? null,
          r2: m.never_observed?.r2 ?? null,
          rmse_all: m.all?.rmse ?? null,
          rmse_never_observed: m.never_observed?.rmse ?? null,
          rmse_observed: m.observed?.rmse ?? null,
          coverage90: hasUnc ? m.uncertainty?.coverage90 ?? null : null,
          scope: 'never-observed cells, shared evaluator',
        });
      }
      res.json({ note: 'published / reproduced / hybrid rows are separate sources. Do not mix.', rows });
    } catch (e) {
      next(e);
    }
  });

  app.get('/map', (req, res) => {
    const layer = req.query.layer as MapLayer;
    if (!MAP_LAYERS.includes(layer))
      throw new HttpError(400, 'bad_param', `"layer" must be one of ${MAP_LAYERS.join(', ')}`);
    mapResponse(req, res, layer);
  });

  app.get('/density', (req, res) => {
    const dir = runDir(req.query.run);
    const densityNpy = arr(dir, 'density', false);
    if (!densityNpy) {
      throw new HttpError(404, 'not_available', 'observation density array not available for this run');
    }
    mapResponse(req, res, 'density');
  });

  app.get('/reliability/:kind', (req, res) => {
    const dir = runDir(req.query.run);
    const kind = req.params.kind;
    const candidates: Record<string, string[]> = {
      density: ['density_bins.json', 'density.json'],
      density_bins: ['density_bins.json'],
      calibration: ['calibration.json'],
      depth: ['by_depth.json', 'depth.json'],
      by_depth: ['by_depth.json'],
      uncertainty: ['uncertainty.json'],
      thresholds: ['thresholds.json'],
    };

    const fileList = candidates[kind] ?? [`${kind}.json`];
    let filePath: string | null = null;
    for (const f of fileList) {
      const p = path.join(dir, 'analysis', f);
      if (fs.existsSync(p)) {
        filePath = p;
        break;
      }
    }

    if (!filePath) {
      throw new HttpError(404, 'not_available', `reliability analysis "${kind}" not available for this run`);
    }

    if (setCaching(req, res, filePath)) return;
    res.json(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  });

  app.get('/timeseries', (req, res) => {
    const runId = String(req.query.run);
    const dir = runDir(req.query.run);
    const metaPath = path.join(dir, 'metadata.json');
    if (setCaching(req, res, metaPath)) return;

    const runInfo = getIngestedRun(runId);
    const meta = readJson(dir, 'metadata.json');
    const [ny, nd, nlat, nlon] = arr(dir, 'truth')!.shape;
    const di = int(req.query, 'depth', 0, nd - 1);
    const { lat, lon, bad } = cellCheck(req, dir, nd, nlat, nlon);
    if (bad(di))
      throw new HttpError(422, 'land_cell', `cell (depth ${di}, lat ${lat}, lon ${lon}) is land or below seafloor`);

    const t = arr(dir, 'truth')!,
      p = arr(dir, 'prediction')!,
      s = arr(dir, 'uncertainty')!,
      o = arr(dir, 'observed')!;
    const rd = (a: typeof t) => Array.from({ length: ny }, (_, y) => readAt(a, [y, di, lat, lon]));
    const truth = rd(t),
      pred = rd(p),
      std = rd(s),
      obs = rd(o);

    const hasUnc = runInfo?.capabilities.uncertainty !== false;
    const lower90 = hasUnc ? pred.map((v, i) => nn(v - Z90 * std[i])) : null;
    const upper90 = hasUnc ? pred.map((v, i) => nn(v + Z90 * std[i])) : null;

    res.json({
      years: meta.years,
      depth_idx: di,
      depth_m: meta.depth_labels_m[di],
      lat,
      lon,
      truth: truth.map(nn),
      prediction: pred.map(nn),
      lower90,
      upper90,
      observed: obs.map((v) => v === 1),
      simulation_caveat: true,
    });
  });

  app.get('/profile', (req, res) => {
    const runId = String(req.query.run);
    const dir = runDir(req.query.run);
    const metaPath = path.join(dir, 'metadata.json');
    if (setCaching(req, res, metaPath)) return;

    const runInfo = getIngestedRun(runId);
    const meta = readJson(dir, 'metadata.json');
    const [, nd, nlat, nlon] = arr(dir, 'truth')!.shape;
    const year = int(req.query, 'year', meta.years[0], meta.years[meta.years.length - 1]);
    const yi = meta.years.indexOf(year);
    const { lat, lon, bad } = cellCheck(req, dir, nd, nlat, nlon);

    const t = arr(dir, 'truth')!,
      p = arr(dir, 'prediction')!,
      s = arr(dir, 'uncertainty')!,
      o = arr(dir, 'observed')!;
    const valid = Array.from({ length: nd }, (_, d) => !bad(d));
    if (!valid.some(Boolean))
      throw new HttpError(422, 'land_cell', `column (lat ${lat}, lon ${lon}) is land`);

    const col = (a: typeof t) =>
      Array.from({ length: nd }, (_, d) => (valid[d] ? readAt(a, [yi, d, lat, lon]) : NaN));

    const hasUnc = runInfo?.capabilities.uncertainty !== false;

    res.json({
      year,
      lat,
      lon,
      depth_m: meta.depth_labels_m,
      truth: col(t).map(nn),
      prediction: col(p).map(nn),
      std: hasUnc ? col(s).map(nn) : null,
      observed: col(o).map((v) => (Number.isNaN(v) ? null : v === 1)),
      simulation_caveat: true,
    });
  });

  app.post('/admin/rescan', async (req, res, next) => {
    try {
      const token = req.headers['x-admin-token'];
      if (!config.adminToken || token !== config.adminToken) {
        throw new HttpError(403, 'forbidden', 'admin token missing or invalid');
      }

      const runs = await ingestAll();
      let checksumResults: any = undefined;

      if (req.query.verify === '1') {
        checksumResults = await verifyChecksums();
      }

      res.json({
        status: 'ok',
        rescanned: runs.length,
        runs: runs.map((r) => ({ id: r.id, status: r.status, capabilities: r.capabilities })),
        checksum_results: checksumResults,
      });
    } catch (err) {
      next(err);
    }
  });

  app.get('/physics-audit', (req, res) => {
    const dir = runDir(req.query.run);
    if (!arr(dir, 'physics', false))
      throw new HttpError(501, 'not_available', 'physics_audit.npy not produced for this run yet');
    res.status(501).json({ error: { code: 'todo', message: 'wire once M3 defines physics_audit.npy layout' } });
  });

  app.use((_q, _r, next) => next(new HttpError(404, 'no_route', 'unknown endpoint')));
  app.use((e: Error, _q: Request, res: Response, _n: NextFunction) => {
    if (e instanceof HttpError)
      return res.status(e.status).json({ error: { code: e.code, message: e.message } });
    if (e instanceof RangeError)
      return res.status(400).json({ error: { code: 'bad_index', message: e.message } });
    console.error(e);
    res.status(500).json({ error: { code: 'internal', message: 'internal error' } });
  });

  return app;
}
