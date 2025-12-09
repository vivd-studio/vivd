import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '@backend/routers/appRouter';

export const trpc = createTRPCReact<AppRouter>();
