import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env file from repo root.
// From `packages/backend/src` (or `packages/backend/dist`), this is `../../../.env`.
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
