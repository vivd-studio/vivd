
import { processUrl } from './index';
import { fileURLToPath } from 'url';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.error('Usage: npx tsx cli.ts <url>');
        process.exit(1);
    }
    processUrl(args[0]).catch(error => {
        console.error('An error occurred:', error);
    });
}
