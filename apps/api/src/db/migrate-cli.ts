import { loadConfig } from '../env';
import { createDb } from './index';

try {
  process.loadEnvFile('../../.env');
} catch {
  /* optional */
}
const cfg = loadConfig();
createDb(cfg.databasePath);
console.log(`Migrated ${cfg.databasePath}`);
