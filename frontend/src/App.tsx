import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Signup from "./pages/Signup";
import Admin from "./pages/Admin";
import Settings from "./pages/Settings";
import PreviewPage from "./pages/PreviewPage";
import ScratchWizard from "./pages/ScratchWizard";
import { Layout } from "@/components/Layout";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/lib/trpc";
import { Toaster } from "@/components/ui/sonner";
// ...
export default function App() {
  const { data: session, isPending: isSessionPending } =
    authClient.useSession();

  const {
    data: hasUsersData,
    isLoading: isHasUsersLoading,
    isError,
    error,
  } = trpc.user.hasUsers.useQuery();

  if (isSessionPending || isHasUsersLoading)
    return (
      <div className="flex h-screen items-center justify-center">
        Loading...
      </div>
    );

  if (isError) {
    return (
      <div className="p-4 text-red-500">
        Error checking system status. Please check console and backend logs.{" "}
        {String(error)}
      </div>
    );
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
    );
  }

  // Normal flow
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/vivd-studio/login"
          element={!session ? <Login /> : <Navigate to="/vivd-studio" />}
        />
        {/* Nested routes under /vivd-studio with Layout */}
        <Route
          path="/vivd-studio"
          element={session ? <Layout /> : <Navigate to="/vivd-studio/login" />}
        >
          <Route index element={<Dashboard />} />
          <Route path="settings" element={<Settings />} />
          <Route
            path="admin"
            element={
              session?.user?.role === "admin" ? (
                <Admin />
              ) : (
                <Navigate to="/vivd-studio" />
              )
            }
          />
        </Route>
        {/* PreviewPage outside Layout - has its own full-screen UI */}
        <Route
          path="/vivd-studio/projects/:projectSlug"
          element={
            session ? <PreviewPage /> : <Navigate to="/vivd-studio/login" />
          }
        />
        <Route
          path="/vivd-studio/projects/new/scratch"
          element={
            session ? <ScratchWizard /> : <Navigate to="/vivd-studio/login" />
          }
        />
        <Route
          path="/"
          element={
            session ? (
              <Navigate to="/vivd-studio" />
            ) : (
              <Navigate to="/vivd-studio/login" />
            )
          }
        />
      </Routes>
      <Toaster />
    </BrowserRouter>
  );
}
