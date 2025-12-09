import dotenv from 'dotenv';
import path from 'path';

// Load .env file from root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
