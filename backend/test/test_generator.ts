import { generateLandingPage } from '../src/generator/generator';
import * as path from 'path';

async function test() {
    const targetDir = path.join(process.cwd(), 'generated', 'bbbistro');
    console.log(`Testing generator on ${targetDir}`);
    await generateLandingPage(targetDir);
}

test().catch(console.error);
