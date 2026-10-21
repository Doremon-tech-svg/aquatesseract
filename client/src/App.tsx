import { useEffect, useRef, useState } from 'react';
import { api, CalibrationData, CompRow, DensityBin, DepthLevelStat, MapData, Metadata, RunItem } from './api';

function color(t: number): string {
  // simple blue -> yellow ramp
  const clamped = Math.max(0, Math.min(1, t));
  const r = Math.round(40 + 215 * clamped);
  const g = Math.round(70 + 170 * clamped);
  const b = Math.round(160 - 120 * clamped);
  return `rgb(${r},${g},${b})`;
}

function MapCanvas({ data }: { data: MapData }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const [rows, cols] = data.shape,
      px = 6;
    cv.width = cols * px;
    cv.height = rows * px;
    const ctx = cv.getContext('2d')!;
    const lo = data.min ?? 0,
      span = (data.max ?? 1) - lo || 1;
    data.values.forEach((v, i) => {
      const r = Math.floor(i / cols),
        c = i % cols;
      ctx.fillStyle = v === null ? '#2b2b2b' : color((v - lo) / span); // land = dark grey
      ctx.fillRect(c * px, (rows - 1 - r) * px, px, px); // north up
    });
  }, [data]);
  return <canvas ref={ref} className="map" />;
}

export default function App() {
  const [runs, setRuns] = useState<RunItem[]>([]);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [meta, setMeta] = useState<Metadata | null>(null);
  const [metrics, setMetrics] = useState<any | null>(null);
  const [layer, setLayer] = useState('prediction');
  const [year, setYear] = useState(0);
  const [depth, setDepth] = useState(0);
  const [map, setMap] = useState<MapData | null>(null);
  const [rows, setRows] = useState<CompRow[]>([]);
  const [err, setErr] = useState('');

  // Reliability data for hybrid runs
  const [calData, setCalData] = useState<CalibrationData | null>(null);
  const [densityBins, setDensityBins] = useState<Record<string, DensityBin> | null>(null);
  const [depthStats, setDepthStats] = useState<DepthLevelStat[] | null>(null);

  const selectedRun = runs.find((r) => r.id === selectedRunId);

  useEffect(() => {
    api
      .runs()
      .then((r) => {
        setRuns(r.runs);
        if (r.runs.length > 0) {
          setSelectedRunId(r.runs[0].id);
        }
      })
      .catch((e) => setErr(e.message));

    api
      .comparison()
      .then((r) => setRows(r.rows))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!selectedRunId) return;
    api
      .metadata(selectedRunId)
      .then((m) => {
        setMeta(m);
        setYear(m.years[0]);
      })
      .catch((e) => setErr(e.message));

    api
      .metrics(selectedRunId)
      .then((m) => setMetrics(m))
      .catch(() => setMetrics(null));

    // Reset and fetch reliability
    setCalData(null);
    setDensityBins(null);
    setDepthStats(null);

    api
      .reliability<CalibrationData>('calibration', selectedRunId)
      .then(setCalData)
      .catch(() => setCalData(null));

    api
      .reliability<Record<string, DensityBin>>('density', selectedRunId)
      .then(setDensityBins)
      .catch(() => setDensityBins(null));

    api
      .reliability<DepthLevelStat[]>('depth', selectedRunId)
      .then(setDepthStats)
      .catch(() => setDepthStats(null));
  }, [selectedRunId]);

  useEffect(() => {
    if (!selectedRunId || !meta) return;
    // Fallback if layer is uncertainty but run lacks uncertainty
    let targetLayer = layer;
    if (layer === 'uncertainty' && !selectedRun?.capabilities.uncertainty) {
      targetLayer = 'prediction';
      setLayer('prediction');
    }
    api
      .map(selectedRunId, targetLayer, year, depth, 1)
      .then((m) => {
        setMap(m);
        setErr('');
      })
      .catch((e) => setErr(e.message));
  }, [selectedRunId, meta, layer, year, depth, selectedRun]);

  const temporalRows = rows.filter((r) => r.split === 'temporal');
  const spatialRows = rows.filter((r) => r.split === 'spatial');

  return (
    <>
      <div className="banner">
        ⚠ Evaluated on a <b>simulated</b> ocean (OceanVerse digital twin). Predictions are not new measurements.
        Precomputed results, not live inference.
      </div>
      <main>
        <div className="header-nav">
          <button
            className="btn-back"
            onClick={() => {
              window.location.hash = '';
              window.scrollTo(0, 0);
            }}
          >
            ← Landing
          </button>
          <h1>AquaTesseract · Reconstruction Explorer</h1>
        </div>

        {err && <p className="err">{err}</p>}
        {!runs.length && !err && (
          <p>
            No runs found. Run <code>make mock</code>.
          </p>
        )}

        {meta && selectedRun && (
          <section className="controls">
            <div className="control-group">
              <label>
                Run
                <select value={selectedRunId} onChange={(e) => setSelectedRunId(e.target.value)}>
                  {runs.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.id}
                    </option>
                  ))}
                </select>
              </label>
              <div className="badges-row">
                <span className="badge badge-split">{selectedRun.split}</span>
                <span className="badge badge-model">{selectedRun.model}</span>
                {(meta.x_drop !== undefined && meta.x_drop !== null) ||
                (meta.do_drop !== undefined && meta.do_drop !== null) ? (
                  <span className="badge badge-drop">
                    {meta.x_drop ? `x_drop:${meta.x_drop}` : `do_drop:${meta.do_drop}`}
                  </span>
                ) : null}
                {selectedRun.id.startsWith('MOCK_') && <span className="badge badge-mock">mock</span>}
              </div>
            </div>

            <label>
              Layer
              <select value={layer} onChange={(e) => setLayer(e.target.value)}>
                {meta.layers.map((l) => {
                  const isUnc = l === 'uncertainty';
                  const isDens = l === 'density';
                  const disabled =
                    (isUnc && !selectedRun.capabilities.uncertainty) || (isDens && !selectedRun.capabilities.density);
                  const tooltip =
                    isUnc && !selectedRun.capabilities.uncertainty
                      ? 'No genuine uncertainty for this model'
                      : undefined;
                  return (
                    <option key={l} value={l} disabled={disabled} title={tooltip}>
                      {l} {disabled ? ' (unavailable)' : ''}
                    </option>
                  );
                })}
              </select>
            </label>

            <label>
              Year {year}
              <input
                type="range"
                min={meta.years[0]}
                max={meta.years[meta.years.length - 1]}
                value={year}
                onChange={(e) => setYear(+e.target.value)}
              />
            </label>

            <label>
              Depth {meta.depth_labels_m[depth]} m
              <input
                type="range"
                min={0}
                max={meta.depth_labels_m.length - 1}
                value={depth}
                onChange={(e) => setDepth(+e.target.value)}
              />
            </label>
          </section>
        )}

        {map && <MapCanvas data={map} />}
        {map && (
          <p className="legend">
            {map.layer}: {map.min?.toFixed(3)} → {map.max?.toFixed(3)} · units: {map.oxygen_units}
          </p>
        )}

        {/* Reliability Section */}
        <section className="reliability-section">
          <h2>Reliability & Uncertainty</h2>
          {!selectedRun?.capabilities.uncertainty ? (
            <div className="unc-not-available">Uncertainty not available for this model</div>
          ) : (
            <>
              {metrics?.uncertainty && (
                <div className="metrics-pill-row">
                  <div className="metric-pill">
                    <span className="pill-label">Coverage (90% Nominal)</span>
                    <span className="pill-val">
                      {(metrics.uncertainty.coverage90 * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="metric-pill">
                    <span className="pill-label">Mean 90% Width</span>
                    <span className="pill-val">
                      {metrics.uncertainty.mean_width90?.toFixed(4) ?? '—'}
                    </span>
                  </div>
                  <div className="metric-pill">
                    <span className="pill-label">Never-Observed Coverage</span>
                    <span className="pill-val">
                      {(metrics.uncertainty.coverage90_never_observed * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
              )}

              <div className="charts-grid">
                {/* Calibration Curve SVG */}
                {calData && (
                  <div className="chart-card">
                    <h3>Calibration Curve</h3>
                    <p className="chart-subtitle">Nominal vs Empirical Coverage</p>
                    <svg viewBox="0 0 260 220" className="chart-svg">
                      {/* Grid & diagonal reference */}
                      <line x1="40" y1="180" x2="240" y2="20" stroke="#4b5563" strokeDasharray="3,3" />
                      <line x1="40" y1="180" x2="240" y2="180" stroke="#6b7280" />
                      <line x1="40" y1="20" x2="40" y2="180" stroke="#6b7280" />

                      {/* Ticks */}
                      <text x="35" y="185" textAnchor="end" fontSize="10" fill="#9ca3af">0.0</text>
                      <text x="35" y="100" textAnchor="end" fontSize="10" fill="#9ca3af">0.5</text>
                      <text x="35" y="25" textAnchor="end" fontSize="10" fill="#9ca3af">1.0</text>
                      <text x="40" y="195" textAnchor="middle" fontSize="10" fill="#9ca3af">0.0</text>
                      <text x="140" y="195" textAnchor="middle" fontSize="10" fill="#9ca3af">0.5</text>
                      <text x="240" y="195" textAnchor="middle" fontSize="10" fill="#9ca3af">1.0</text>

                      {/* Never Observed Line & Points (Emerald) */}
                      {calData.nominal.map((nom, i) => {
                        const x = 40 + nom * 200;
                        const y = 180 - calData.never_observed[i] * 160;
                        const nextNom = calData.nominal[i + 1];
                        const nextX = nextNom ? 40 + nextNom * 200 : null;
                        const nextY = nextNom ? 180 - calData.never_observed[i + 1] * 160 : null;
                        return (
                          <g key={`nev-${i}`}>
                            {nextX && nextY && (
                              <line x1={x} y1={y} x2={nextX} y2={nextY} stroke="#10b981" strokeWidth="2" />
                            )}
                            <circle cx={x} cy={y} r="4" fill="#10b981" />
                          </g>
                        );
                      })}

                      {/* All Line & Points (Amber) */}
                      {calData.nominal.map((nom, i) => {
                        const x = 40 + nom * 200;
                        const y = 180 - calData.all[i] * 160;
                        const nextNom = calData.nominal[i + 1];
                        const nextX = nextNom ? 40 + nextNom * 200 : null;
                        const nextY = nextNom ? 180 - calData.all[i + 1] * 160 : null;
                        return (
                          <g key={`all-${i}`}>
                            {nextX && nextY && (
                              <line x1={x} y1={y} x2={nextX} y2={nextY} stroke="#f59e0b" strokeWidth="2" />
                            )}
                            <circle cx={x} cy={y} r="3" fill="#f59e0b" />
                          </g>
                        );
                      })}
                    </svg>
                    <div className="chart-legend">
                      <span className="legend-item"><span className="legend-dot" style={{ background: '#10b981' }} /> never-obs</span>
                      <span className="legend-item"><span className="legend-dot" style={{ background: '#f59e0b' }} /> all cells</span>
                      <span className="legend-item"><span className="legend-dash" /> ideal y=x</span>
                    </div>
                  </div>
                )}

                {/* Error vs Density Bins */}
                {densityBins && (
                  <div className="chart-card">
                    <h3>Error by Observation Density</h3>
                    <p className="chart-subtitle">RMSE Across Density Quartiles</p>
                    <svg viewBox="0 0 280 220" className="chart-svg">
                      <line x1="40" y1="180" x2="270" y2="180" stroke="#6b7280" />
                      <line x1="40" y1="20" x2="40" y2="180" stroke="#6b7280" />
                      {(() => {
                        const bins = ['very_sparse', 'sparse', 'medium', 'well_observed'];
                        const vals = bins.map((b) => densityBins[b]?.rmse ?? 0);
                        const maxVal = Math.max(...vals, 0.08) * 1.15;
                        return bins.map((b, i) => {
                          const v = densityBins[b]?.rmse ?? 0;
                          const barH = (v / maxVal) * 150;
                          const x = 55 + i * 52;
                          const y = 180 - barH;
                          return (
                            <g key={b}>
                              <rect x={x} y={y} width="36" height={barH} fill="#3b82f6" rx="3" />
                              <text x={x + 18} y={y - 5} textAnchor="middle" fontSize="10" fill="#93c5fd">
                                {v.toFixed(3)}
                              </text>
                              <text x={x + 18} y="196" textAnchor="middle" fontSize="9" fill="#9ca3af">
                                {b.replace('_', ' ')}
                              </text>
                            </g>
                          );
                        });
                      })()}
                    </svg>
                    <div className="chart-legend">
                      <span className="legend-item"><span className="legend-dot" style={{ background: '#3b82f6' }} /> RMSE on Ocean Cells</span>
                    </div>
                  </div>
                )}

                {/* By-Depth RMSE Profile */}
                {depthStats && (
                  <div className="chart-card">
                    <h3>Error by Depth</h3>
                    <p className="chart-subtitle">0 m (surface) to 5,500 m</p>
                    <svg viewBox="0 0 240 220" className="chart-svg">
                      <line x1="50" y1="180" x2="230" y2="180" stroke="#6b7280" />
                      <line x1="50" y1="20" x2="50" y2="180" stroke="#6b7280" />
                      <text x="45" y="25" textAnchor="end" fontSize="9" fill="#9ca3af">0 m</text>
                      <text x="45" y="100" textAnchor="end" fontSize="9" fill="#9ca3af">2000 m</text>
                      <text x="45" y="180" textAnchor="end" fontSize="9" fill="#9ca3af">5500 m</text>

                      {(() => {
                        const maxRmse = 0.08;
                        const pointsAll: string[] = [];
                        const pointsNev: string[] = [];
                        depthStats.forEach((st, idx) => {
                          const y = 20 + (idx / (depthStats.length - 1)) * 160;
                          if (st.all.rmse !== null) {
                            const xAll = 50 + (st.all.rmse / maxRmse) * 170;
                            pointsAll.push(`${xAll},${y}`);
                          }
                          if (st.never_observed.rmse !== null) {
                            const xNev = 50 + (st.never_observed.rmse / maxRmse) * 170;
                            pointsNev.push(`${xNev},${y}`);
                          }
                        });
                        return (
                          <>
                            <polyline fill="none" stroke="#f59e0b" strokeWidth="1.5" points={pointsAll.join(' ')} />
                            <polyline fill="none" stroke="#10b981" strokeWidth="2" points={pointsNev.join(' ')} />
                          </>
                        );
                      })()}
                    </svg>
                    <div className="chart-legend">
                      <span className="legend-item"><span className="legend-dot" style={{ background: '#10b981' }} /> never-obs</span>
                      <span className="legend-item"><span className="legend-dot" style={{ background: '#f59e0b' }} /> all cells</span>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </section>

        {/* Model Comparison Section */}
        <h2>Model comparison</h2>

        {/* Published Results (Temporal) */}
        <h3>Published (temporal split, different protocol)</h3>
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th>Model</th>
              <th>x_drop / do_drop</th>
              <th>RMSE all</th>
              <th>RMSE never-observed</th>
              <th>observed cells (contract group)</th>
              <th>coverage90</th>
            </tr>
          </thead>
          <tbody>
            {temporalRows.map((r, i) => (
              <tr key={i}>
                <td><span className={`tag ${r.source}`}>{r.source}</span></td>
                <td>{r.model}</td>
                <td>—</td>
                <td>{r.rmse_all?.toFixed(4) ?? '—'}</td>
                <td>{r.rmse_never_observed?.toFixed(4) ?? r.rmse?.toFixed(4) ?? '—'}</td>
                <td>{r.rmse_observed?.toFixed(4) ?? '—'}</td>
                <td>{r.coverage90 ? `${(r.coverage90 * 100).toFixed(1)}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Ours (Spatial) */}
        <h3 style={{ marginTop: '24px' }}>Ours (spatial split)</h3>
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th>Model</th>
              <th>x_drop / do_drop</th>
              <th>RMSE all</th>
              <th>RMSE never-observed</th>
              <th>observed cells (contract group)</th>
              <th>coverage90</th>
            </tr>
          </thead>
          <tbody>
            {spatialRows.map((r, i) => {
              const dropLabel = r.x_drop ? `x_drop: ${r.x_drop}` : r.do_drop ? `do_drop: ${r.do_drop}` : '—';
              return (
                <tr key={i}>
                  <td><span className={`tag ${r.source}`}>{r.source}</span></td>
                  <td>{r.model}</td>
                  <td>{dropLabel}</td>
                  <td>{r.rmse_all?.toFixed(4) ?? '—'}</td>
                  <td>{r.rmse_never_observed?.toFixed(4) ?? r.rmse?.toFixed(4) ?? '—'}</td>
                  <td>{r.rmse_observed?.toFixed(4) ?? '—'}</td>
                  <td>{r.coverage90 ? `${(r.coverage90 * 100).toFixed(1)}%` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <p className="sim-note">one seed, one simulation, simulation not real ocean</p>
      </main>
    </>
  );
}
