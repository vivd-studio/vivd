import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { toNodeHandler } from "better-auth/node";
import { auth } from './auth';
import { processUrl } from './generator/index';
import { pool, db } from './db';

dotenv.config({ path: path.resolve(__dirname, '../../.env') }); // Adjust path if needed

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true
}));
app.use(express.json());

// Auth Routes
app.all("/api/auth/*path", toNodeHandler(auth));

// Static files
app.use('/generated', express.static(path.join(__dirname, '../generated')));
app.use('/preview', express.static(path.join(__dirname, '../generated')));

// Generate Endpoint
app.post('/api/generate', async (req, res) => {
    // Convert express headers to standard Headers
    const headers = new Headers();
    Object.entries(req.headers).forEach(([key, value]) => {
        if (typeof value === 'string') {
            headers.append(key, value);
        } else if (Array.isArray(value)) {
            value.forEach(v => headers.append(key, v));
        }
    });

    const session = await auth.api.getSession({
        headers: headers
    });

    if (!session) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const { url } = req.body;
    if (!url) {
        return res.status(400).json({ error: "URL is required" });
    }

    try {
        // Trigger generic process
        // Note: processUrl is async. We might want to run it in background or await.
        // For now, await it (long running!)
        // User said "get displayed the final result eventually".
        // Maybe return a job ID? But for now, simple await or fire-and-forget.
        // User wants "result eventually".
        // Let's await it for simplicity or until timeout?
        // Puppeteer might take time.
        // Better: fire and forget, but how to get result?
        // We'll return "Processing started" and the output path.
        // But client needs to poll?
        // Let's just await for the MVP unless it times out. 
        // 30s timeout might be exceeded.
        // I will return success immediately and let it run.

        processUrl(url).then(() => {
            console.log(`Finished processing ${url}`);
        }).catch(err => {
            console.error(`Error processing ${url}:`, err);
        });

        // We can guess the slug
        let targetUrl = url;
        if (!targetUrl.startsWith('http')) targetUrl = 'https://' + targetUrl;
        const domainSlug = new URL(targetUrl).hostname.replace('www.', '').split('.')[0];

        res.json({ status: 'processing', slug: domainSlug, message: "Generation started." });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

app.get('/api/status/:slug', async (req, res) => {
    const { slug } = req.params;
    const outputDir = path.join(__dirname, '../generated', slug);
    const fs = require('fs'); // lazy load

    if (fs.existsSync(path.join(outputDir, 'index.html'))) {
        res.json({ status: 'completed', url: `/generated/${slug}/index.html` });
    } else {
        res.json({ status: 'processing' });
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.get('/api/has-users', async (req, res) => {
    try {
        const user = await db.query.user.findFirst();
        res.json({ hasUsers: !!user });
    } catch (error) {
        console.error("Failed to check users:", error);
        res.json({ hasUsers: false });
    }
});

app.get('/api/projects', (req, res) => {
    const fs = require('fs');
    const generatedDir = path.join(__dirname, '../generated');

    if (!fs.existsSync(generatedDir)) {
        return res.json({ projects: [] });
    }

    try {
        const files = fs.readdirSync(generatedDir, { withFileTypes: true });
        const projects = files
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);
        res.json({ projects });
    } catch (error) {
        console.error("Failed to list projects:", error);
        res.status(500).json({ error: "Failed to list projects" });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
