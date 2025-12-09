import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import Login from "./pages/Login"
import Dashboard from "./pages/Dashboard"
import Signup from "./pages/Signup"
import { authClient } from "@/lib/auth-client"
import { useQuery } from "@tanstack/react-query"
import { getApiHasUsers } from "@/client/sdk.gen"

export default function App() {
  const { data: session, isPending: isSessionPending } = authClient.useSession()

  const { data: hasUsersData, isLoading: isHasUsersLoading, isError, error } = useQuery({
    queryKey: ['hasUsers'],
    queryFn: async () => {
      try {
        const { data } = await getApiHasUsers()
        return data
      } catch (err) {
        throw err
      }
    }
  })

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
      </BrowserRouter>
    )
  }

  // Normal flow
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={!session ? <Login /> : <Navigate to="/" />} />
        <Route path="/" element={session ? <Dashboard /> : <Navigate to="/login" />} />
        {/* If users exist but user manually goes to signup, maybe allow or redirect? 
            For this specific "first time setup" requirement, maybe getting to signup is restricted? 
            But better-auth handles auth. 
            If user created, hasUsers is true. 
            So this block won't render. 
            If they want to add more users, better-auth doesn't have a default signup page unless we expose it.
            But the user asked for "When the app starts first time we will see a signup window".
            So subsequent signups might be hidden or manual?
            I'll just leave it as is: redirect to login if users exist.
        */}
      </Routes>
    </BrowserRouter>
  )
}
