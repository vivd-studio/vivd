import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { toNodeHandler } from "better-auth/node";
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { auth } from './auth';
import { appRouter } from './routers/appRouter';
import { createContext } from './trpc';

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

// tRPC
app.use(
    '/trpc',
    createExpressMiddleware({
        router: appRouter,
        createContext,
    }),
);

app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
