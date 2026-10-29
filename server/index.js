import { openDb } from './db.js';
import { createApp } from './app.js';
const db = openDb(process.env.DB_FILE || 'brasa.db'), port = Number(process.env.PORT || 3000);
const app = createApp(db);
app.server.listen(port, () => console.log(`Brasa no ar: http://localhost:${port}`));
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, async () => { await app.close(); db.close(); process.exit(0); });
