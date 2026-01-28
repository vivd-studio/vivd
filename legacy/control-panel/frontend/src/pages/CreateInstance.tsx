import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { trpc } from "../lib/trpc";

export function CreateInstance() {
  const navigate = useNavigate();
  const createMutation = trpc.instances.create.useMutation({
    onSuccess: () => {
      navigate("/");
    },
  });

  const [formData, setFormData] = useState({
    name: "",
    slug: "",
    domain: "",
    singleProjectMode: false,
    githubRepoPrefix: "",
    // API Keys - optional, uses shared if empty
    openrouterApiKey: "",
    googleApiKey: "",
    githubToken: "",
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Filter out empty optional fields
    const payload = {
      name: formData.name,
      domain: formData.domain,
      singleProjectMode: formData.singleProjectMode,
      ...(formData.slug && { slug: formData.slug }),
      ...(formData.githubRepoPrefix && {
        githubRepoPrefix: formData.githubRepoPrefix,
      }),
      ...(formData.openrouterApiKey && {
        openrouterApiKey: formData.openrouterApiKey,
      }),
      ...(formData.googleApiKey && { googleApiKey: formData.googleApiKey }),
      ...(formData.githubToken && { githubToken: formData.githubToken }),
    };

    createMutation.mutate(payload);
  };

  const autoSlug = formData.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return (
    <div>
      <div className="page-header">
        <h1>Create New Instance</h1>
        <p>Deploy a new Vivd instance with custom configuration.</p>
      </div>

      <form className="form" onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="form-label">Instance Name *</label>
          <input
            type="text"
            name="name"
            className="form-input"
            placeholder="e.g. Client A, Demo Site"
            value={formData.name}
            onChange={handleChange}
            required
          />
        </div>

        <div className="form-group">
          <label className="form-label">Slug</label>
          <input
            type="text"
            name="slug"
            className="form-input"
            placeholder={autoSlug || "auto-generated from name"}
            value={formData.slug}
            onChange={handleChange}
          />
          <span className="form-hint">
            Used for internal ID and GitHub repo prefix. Auto-generated if
            empty.
          </span>
        </div>

        <div className="form-group">
          <label className="form-label">Domain *</label>
          <input
            type="text"
            name="domain"
            className="form-input"
            placeholder="e.g. client-a.vivd.studio or client-a.example.com"
            value={formData.domain}
            onChange={handleChange}
            required
          />
          <span className="form-hint">
            Must be a valid domain that will point to this instance.
          </span>
        </div>

        <div className="form-group">
          <label className="form-label">GitHub Repo Prefix</label>
          <input
            type="text"
            name="githubRepoPrefix"
            className="form-input"
            placeholder={`${autoSlug || "instance"}-`}
            value={formData.githubRepoPrefix}
            onChange={handleChange}
          />
          <span className="form-hint">
            Prefix for GitHub repositories created by this instance.
          </span>
        </div>

        <div className="form-checkbox">
          <input
            type="checkbox"
            name="singleProjectMode"
            id="singleProjectMode"
            checked={formData.singleProjectMode}
            onChange={handleChange}
          />
          <label htmlFor="singleProjectMode">Single Project Mode</label>
        </div>

        <hr
          style={{
            border: "none",
            borderTop: "1px solid var(--color-border)",
            margin: "1rem 0",
          }}
        />

        <h3
          style={{
            fontSize: "1rem",
            color: "var(--color-text-muted)",
            marginBottom: "0.5rem",
          }}
        >
          API Keys (optional - uses shared keys if empty)
        </h3>

        <div className="form-group">
          <label className="form-label">OpenRouter API Key</label>
          <input
            type="password"
            name="openrouterApiKey"
            className="form-input"
            placeholder="sk-or-v1-..."
            value={formData.openrouterApiKey}
            onChange={handleChange}
          />
        </div>

        <div className="form-group">
          <label className="form-label">Google API Key</label>
          <input
            type="password"
            name="googleApiKey"
            className="form-input"
            placeholder="AIza..."
            value={formData.googleApiKey}
            onChange={handleChange}
          />
        </div>

        <div className="form-group">
          <label className="form-label">GitHub Token</label>
          <input
            type="password"
            name="githubToken"
            className="form-input"
            placeholder="ghp_..."
            value={formData.githubToken}
            onChange={handleChange}
          />
        </div>

        {createMutation.isError && (
          <div
            style={{
              color: "var(--color-error)",
              padding: "1rem",
              background: "rgba(239, 68, 68, 0.1)",
              borderRadius: "8px",
            }}
          >
            Error: {createMutation.error.message}
          </div>
        )}

        <div style={{ display: "flex", gap: "1rem" }}>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? "Creating..." : "Create Instance"}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate("/")}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
