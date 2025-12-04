import * as fs from 'fs';
import * as path from 'path';
import { LocalCursorAgent } from '../src/agent';
import { log } from '../src/logger';

async function testVision() {
    const testDir = path.join(process.cwd(), 'test', 'test_vision');
    
    // Create test directory
    if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
    }

    // Copy a source image to the test directory
    const sourceImage = path.join(process.cwd(), 'screenshot.png');
    const targetImage = path.join(testDir, 'screenshot.png');

    if (fs.existsSync(sourceImage)) {
        fs.copyFileSync(sourceImage, targetImage);
        log(`Copied screenshot.png to ${testDir}`);
    } else {
        log(`Error: Source image ${sourceImage} not found.`);
        return;
    }

    const agent = new LocalCursorAgent();
    
    log('Starting vision test...');
    log('Asking agent to describe the image...');

    const prompt = `
    Look at the image at ./screenshot.png
    
    Please describe what you see in this image in detail.
    I am testing if you can read the file correctly.
    
    Just output the description as plain text.
    `;

    try {
        // We pass the screenshot path as the second argument, though strictly for the local agent 
        // with my recent changes, the path is embedded in the prompt or the agent looks in cwd.
        // The generate method signature is (prompt, screenshotPath, outputDir).
        await agent.generate(prompt, targetImage, testDir);
        log('Test finished.');
    } catch (error) {
        console.error('Test failed:', error);
    }
}

testVision().catch(console.error);


