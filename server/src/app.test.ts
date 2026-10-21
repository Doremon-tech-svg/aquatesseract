import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { config } from './config';
import { ingestAll } from './ingest';

describe('Server API Endpoints', () => {
  const app = createApp();
  const baseMock = path.join(config.resultsDir, 'MOCK_CESM2_omip1_temporal_hybrid_base_seed0');
  const placeholderDir = path.join(config.resultsDir, 'MOCK_test_placeholder_run');

  beforeAll(async () => {
    // Set up placeholder run without genuine uncertainty
    if (fs.existsSync(baseMock)) {
      fs.mkdirSync(placeholderDir, { recursive: true });
      for (const f of ['truth.npy', 'pred_mean.npy', 'pred_std.npy', 'observed_mask.npy', 'ocean_mask.npy']) {
        fs.copyFileSync(path.join(baseMock, f), path.join(placeholderDir, f));
      }
      const meta = JSON.parse(fs.readFileSync(path.join(baseMock, 'metadata.json'), 'utf8'));
      meta.has_uncertainty = false;
      meta.pred_std_is_placeholder = true;
      fs.writeFileSync(path.join(placeholderDir, 'metadata.json'), JSON.stringify(meta, null, 2));

      const cfg = JSON.parse(fs.readFileSync(path.join(baseMock, 'config.json'), 'utf8'));
      cfg.has_uncertainty = false;
      cfg.pred_std_is_placeholder = true;
      cfg.model = 'lstm';
      fs.writeFileSync(path.join(placeholderDir, 'config.json'), JSON.stringify(cfg, null, 2));

      const metrics = JSON.parse(fs.readFileSync(path.join(baseMock, 'metrics.json'), 'utf8'));
      delete metrics.uncertainty;
      fs.writeFileSync(path.join(placeholderDir, 'metrics.json'), JSON.stringify(metrics, null, 2));
    }

    await ingestAll();
  });

  afterAll(() => {
    if (fs.existsSync(placeholderDir)) {
      fs.rmSync(placeholderDir, { recursive: true, force: true });
    }
  });

  it('/runs returns expected shape and supports ids=1', async () => {
    const res = await request(app).get('/runs');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.runs)).toBe(true);
    expect(res.body.runs.length).toBeGreaterThan(0);

    const first = res.body.runs[0];
    expect(first).toHaveProperty('id');
    expect(first).toHaveProperty('status');
    expect(first).toHaveProperty('capabilities');
    expect(first.capabilities).toHaveProperty('uncertainty');
    expect(first.capabilities).toHaveProperty('density');
    expect(first.capabilities).toHaveProperty('analysis');
    expect(first.capabilities).toHaveProperty('physics');

    const resIds = await request(app).get('/runs?ids=1');
    expect(resIds.status).toBe(200);
    expect(Array.isArray(resIds.body.runs)).toBe(true);
    expect(typeof resIds.body.runs[0]).toBe('string');
  });

  it('rejects bad run with 404', async () => {
    const res = await request(app).get('/metadata?run=nonexistent_invalid_run');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('run_not_found');
  });

  it('rejects land cell with 422 on /timeseries', async () => {
    // In mock grid, find a cell where ocean is 0 at depth 0
    // Latitude 0, longitude 0 in mock: check cell
    const res = await request(app).get(
      '/timeseries?run=MOCK_CESM2_omip1_temporal_hybrid_base_seed0&depth=0&lat=12&lon=8'
    );
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('land_cell');
  });

  it('returns 404 not_available for layer=uncertainty on placeholder run', async () => {
    const res = await request(app).get(
      '/map?run=MOCK_test_placeholder_run&layer=uncertainty&year=1948&depth=0'
    );
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_available');
  });

  it('returns 404 not_available for missing analysis on /reliability/:kind', async () => {
    const res = await request(app).get(
      '/reliability/calibration?run=MOCK_CESM2_omip1_temporal_hybrid_base_seed0'
    );
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_available');
  });

  it('/comparison returns null coverage for placeholder run', async () => {
    const res = await request(app).get('/comparison');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.rows)).toBe(true);

    const placeholderRow = res.body.rows.find((r: any) => r.run === 'MOCK_test_placeholder_run');
    expect(placeholderRow).toBeDefined();
    expect(placeholderRow.coverage90).toBeNull();
    expect(placeholderRow.has_uncertainty).toBe(false);
  });
});
