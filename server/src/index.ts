import { createApp } from './app';
import { config } from './config';
import { initDb } from './db';
import { ingestAll } from './ingest';

const app = createApp();
// Start listening immediately so health probes succeed during DB back-off
app.listen(config.port, () => console.log(`[api] :${config.port}  results=${config.resultsDir}`));
// Init DB in background and sync ingested runs — server stays up even if DB is unreachable
void initDb().then(() => void ingestAll()).catch(() => undefined);
