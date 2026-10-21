import { createApp } from './app';
import { config } from './config';
import { initDb } from './db';

const app = createApp();
// Start listening immediately so health probes succeed during DB back-off
app.listen(config.port, () => console.log(`[api] :${config.port}  results=${config.resultsDir}`));
// Init DB in background — server stays up even if DB is unreachable
void initDb();
