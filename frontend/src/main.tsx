import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { client } from "@/client/client.gen"

client.setConfig({
  baseUrl: import.meta.env.VITE_API_BASE_URL || "http://localhost:3000",
  credentials: 'include',
})
// Workaround to set credentials for all requests if supported or we rely on individual calls
// Ideally: client.instance.defaults.credentials = 'include' (axios style)
// For fetch-client we might need to intercept.
// Let's rely on manual credentials passing if needed, OR modify the generated client index if needed.
// But mostly authClient uses its own fetch.
// The generated client is for /api/generate
// If session is cookie based, we need credentials.
// I'll add an interceptor if hey-api supports it, otherwise I'll modify the client calls in dashboard.

const queryClient = new QueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
