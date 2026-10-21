import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';
import { HttpError } from './errors';
import { openNpy, Npy } from './npy';

export const FILES = {
  truth: 'truth.npy',
  prediction: 'pred_mean.npy',
  uncertainty: 'pred_std.npy',
  observed: 'observed_mask.npy',
  ocean: 'ocean_mask.npy',
  density: 'observation_density.npy',
  physics: 'physics_audit.npy',
} as const;

export function listRunDirs(): Map<string, string> {
  const map = new Map<string, string>();
  if (!fs.existsSync(config.resultsDir)) return map;

  const entries = fs.readdirSync(config.resultsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const p1 = path.join(config.resultsDir, entry.name);

    if (fs.existsSync(path.join(p1, 'metadata.json'))) {
      if (/^[\w.-]+$/.test(entry.name)) {
        map.set(entry.name, p1);
      }
    }

    // Check depth 2
    try {
      const subEntries = fs.readdirSync(p1, { withFileTypes: true });
      for (const sub of subEntries) {
        if (!sub.isDirectory()) continue;
        const p2 = path.join(p1, sub.name);
        if (fs.existsSync(path.join(p2, 'metadata.json'))) {
          if (/^[\w.-]+$/.test(sub.name)) {
            const id = sub.name;
            if (map.has(id)) {
              if (p2.includes('hybrid_fixed')) {
                console.warn(`Duplicate run ${id}: preferring hybrid_fixed path: ${p2}`);
                map.set(id, p2);
              } else if (!map.get(id)!.includes('hybrid_fixed')) {
                console.warn(`Duplicate run ${id}: keeping first discovered`);
              }
            } else {
              map.set(id, p2);
            }
          }
        }
      }
    } catch {
      // directory read failure ignored
    }
  }
  return map;
}

export function listRuns(): string[] {
  return Array.from(listRunDirs().keys()).sort();
}

export function runDir(run: unknown): string {
  if (typeof run !== 'string' || !/^[\w.-]+$/.test(run)) {
    throw new HttpError(400, 'bad_run', 'query param "run" missing or invalid');
  }
  const dir = listRunDirs().get(run);
  if (!dir || !fs.existsSync(dir)) {
    throw new HttpError(404, 'run_not_found', `no run folder "${run}"`);
  }
  return dir;
}

export const readJson = (dir: string, file: string) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));

export function arr(dir: string, key: keyof typeof FILES, required = true): Npy | null {
  let p = path.join(dir, FILES[key]);
  if (key === 'density') {
    const analysisDensity = path.join(dir, 'analysis', FILES.density);
    if (fs.existsSync(analysisDensity)) {
      p = analysisDensity;
    }
  }

  if (!fs.existsSync(p)) {
    if (required) throw new HttpError(404, 'array_missing', `${FILES[key]} not in this run`);
    return null;
  }
  return openNpy(p);
}
