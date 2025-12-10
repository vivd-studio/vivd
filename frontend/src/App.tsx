import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import Login from "./pages/Login"
import Dashboard from "./pages/Dashboard"
import Signup from "./pages/Signup"
import Admin from "./pages/Admin"
import Settings from "./pages/Settings"
import { Layout } from "@/components/Layout"
import { authClient } from "@/lib/auth-client"
import { trpc } from '@/lib/trpc';
import { Toaster } from "@/components/ui/sonner"
// ...
export default function App() {
  const { data: session, isPending: isSessionPending } = authClient.useSession()

  const { data: hasUsersData, isLoading: isHasUsersLoading, isError, error } = trpc.user.hasUsers.useQuery()

  if (isSessionPending || isHasUsersLoading) return <div className="flex h-screen items-center justify-center">Loading...</div>

  if (isError) {
    return <div className="p-4 text-red-500">Error checking system status. Please check console and backend logs. {String(error)}</div>
  }

  // If no users exist, force signup
  // We explicitly check for false, or if data is missing but no error (edge case) we treat as false just in case
  if (hasUsersData && hasUsersData.hasUsers === false) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="*" element={<Signup />} />
        </Routes>
        <Toaster />
      </BrowserRouter>
    )
  }

  // Normal flow
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={!session ? <Login /> : <Navigate to="/" />} />
        <Route path="/settings" element={
          session ? (
            <Layout>
              <Settings />
            </Layout>
          ) : (
            <Navigate to="/login" />
          )
        } />
        <Route path="/admin" element={
          session?.user?.role === "admin" ? (
            <Layout>
              <Admin />
            </Layout>
          ) : (
            <Navigate to="/" />
          )
        } />
        <Route path="/" element={
          session ? (
            <Layout>
              <Dashboard />
            </Layout>
          ) : (
            <Navigate to="/login" />
          )
        } />
      </Routes>
      <Toaster />
    </BrowserRouter>
  )
}
