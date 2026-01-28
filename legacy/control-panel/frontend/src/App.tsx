import { useState } from "react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { trpc, createTRPCClient } from "./lib/trpc";
import {
  BrowserRouter,
  Routes,
  Route,
  Link,
  Navigate,
} from "react-router-dom";
import { Dashboard } from "./pages/Dashboard";
import { CreateInstance } from "./pages/CreateInstance";
import { Login } from "./pages/Login";
import { Signup } from "./pages/Signup";
import { signOut, useSession } from "./lib/auth";
import "./index.css";

function AppRoutes() {
  const queryClient = useQueryClient();
  const {
    data: hasUsersData,
    isLoading: isHasUsersLoading,
    isError: isHasUsersError,
    error: hasUsersError,
  } = trpc.user.hasUsers.useQuery();
  const {
    data: session,
    isLoading: isSessionLoading,
    isError: isSessionError,
    error: sessionError,
  } = useSession();

  const handleLogout = async () => {
    try {
      await signOut();
    } finally {
      await queryClient.invalidateQueries({ queryKey: ["auth", "session"] });
    }
  };

  if (isHasUsersLoading || isSessionLoading) {
    return (
      <div className="loading">
        <div className="spinner" />
      </div>
    );
  }

  if (isHasUsersError || isSessionError) {
    const message = isHasUsersError
      ? String(hasUsersError)
      : String(sessionError);
    return (
      <div className="auth-page">
        <div className="card auth-card">
          <div className="page-header" style={{ marginBottom: "1rem" }}>
            <h1>Configuration error</h1>
            <p>Failed to connect to the Control Panel backend.</p>
          </div>
          <div style={{ color: "var(--color-error)" }}>{message}</div>
        </div>
      </div>
    );
  }

  // First time setup: no users exist yet
  if (hasUsersData?.hasUsers === false) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="*" element={<Signup />} />
        </Routes>
      </BrowserRouter>
    );
  }

  // Normal flow: require session
  if (!session) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    );
  }

  const isAdmin = session.user.role === "admin";
  if (!isAdmin) {
    return (
      <div className="auth-page">
        <div className="card auth-card">
          <div className="page-header" style={{ marginBottom: "1rem" }}>
            <h1>Access denied</h1>
            <p>Your account does not have admin access.</p>
          </div>
          <button className="btn btn-secondary" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <div className="app">
        <nav className="navbar">
          <div className="navbar-brand">
            <Link to="/">Vivd Control Panel</Link>
          </div>
          <div className="navbar-links">
            <Link to="/">Dashboard</Link>
            <Link to="/create">Create Instance</Link>
            <button
              className="btn btn-secondary"
              style={{ padding: "0.5rem 0.75rem" }}
              onClick={handleLogout}
            >
              Logout
            </button>
          </div>
        </nav>

        <main className="main-content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/create" element={<CreateInstance />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

function App() {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() => createTRPCClient());

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <AppRoutes />
      </QueryClientProvider>
    </trpc.Provider>
  );
}

export default App;
