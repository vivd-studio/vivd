import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { signUpWithEmail } from "../lib/auth";
import { trpc } from "../lib/trpc";

export function Signup() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const utils = trpc.useUtils();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("Admin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await signUpWithEmail({ name, email, password });
      await utils.user.hasUsers.invalidate();
      await queryClient.invalidateQueries({ queryKey: ["auth", "session"] });
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign up failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="card auth-card">
        <div className="page-header" style={{ marginBottom: "1rem" }}>
          <h1>First Time Setup</h1>
          <p>Create your admin account.</p>
        </div>

        <form className="form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Name</label>
            <input
              type="text"
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              type="email"
              className="form-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              type="password"
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
            <span className="form-hint">Minimum 8 characters.</span>
          </div>

          {error && (
            <div
              style={{
                color: "var(--color-error)",
                padding: "1rem",
                background: "rgba(239, 68, 68, 0.1)",
                borderRadius: "8px",
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Creating Account..." : "Create Admin Account"}
          </button>
        </form>
      </div>
    </div>
  );
}

