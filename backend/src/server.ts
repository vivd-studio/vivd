import './init-env';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createOpencode } from "@opencode-ai/sdk";
import { setOpencodeServerUrl } from './opencode';
import { toNodeHandler } from "better-auth/node";
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { auth } from './auth';
import { appRouter } from './routers/appRouter';
import { createContext } from './trpc';

// ESM dirname replacement
const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
app.use('/api/generated', express.static(path.join(__dirname, '../generated')));
app.use('/api/preview', express.static(path.join(__dirname, '../generated')));

// tRPC
app.use(
    '/api/trpc',
    createExpressMiddleware({
        router: appRouter,
        createContext,
    }),
);

app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
});

app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);

    // Initialize OpenCode Server
    try {
        console.log('[OpenCode] Starting internal server...');
        const options: any = {};
        if (process.env.OPENCODE_MODEL) {
            options.config = {
                model: process.env.OPENCODE_MODEL
            };
        }

        // This starts the server
        const instance = await createOpencode(options);
        console.log(`[OpenCode] Server started at ${instance.server.url}`);

        // Set the server URL for the service to use (creates fresh clients per request)
        setOpencodeServerUrl(instance.server.url);

        // Graceful shutdown
        const cleanup = () => {
            console.log('[OpenCode] Stopping server...');
            try {
                instance.server.close();
            } catch (e) {
                // ignore
            }
        };

        process.on('SIGTERM', cleanup);
        process.on('SIGINT', cleanup);
        process.on('exit', cleanup);

        // Note: we don't close the server here, it stays running with the app
    } catch (error) {
        console.error('[OpenCode] Failed to start server:', error);
    }
});
