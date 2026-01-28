import { trpc } from "../lib/trpc";
import { Link } from "react-router-dom";
import { ExternalLink, RefreshCcw, Trash2 } from "lucide-react";

export function Dashboard() {
  const {
    data: instances,
    isLoading,
    isFetching,
    refetch,
  } = trpc.instances.list.useQuery(undefined, { refetchInterval: 10_000 });
  const { data: healthStatus } = trpc.health.dokployHealth.useQuery();
  const redeployMutation = trpc.instances.redeploy.useMutation({
    onSuccess: () => refetch(),
  });
  const deleteMutation = trpc.instances.delete.useMutation({
    onSuccess: () => refetch(),
  });

  const handleRedeploy = (id: string) => {
    if (confirm("Are you sure you want to redeploy this instance?")) {
      redeployMutation.mutate({ id });
    }
  };

  const handleDelete = (id: string) => {
    if (
      confirm(
        "Are you sure you want to delete this instance? This action cannot be undone."
      )
    ) {
      deleteMutation.mutate({ id });
    }
  };

  return (
    <div>
      <div
        className="page-header"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "1rem",
        }}
      >
        <div>
          <h1>Dashboard</h1>
          <p>
            Manage your Vivd instances • Dokploy:{" "}
            <span
              style={{
                color: healthStatus?.connected
                  ? "var(--color-success)"
                  : "var(--color-error)",
              }}
            >
              {healthStatus?.connected ? "Connected" : "Disconnected"}
            </span>
          </p>
        </div>

        <button
          className="btn btn-secondary"
          onClick={() => refetch()}
          disabled={isFetching}
          title="Refresh"
        >
          <RefreshCcw size={14} />
          {isFetching ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {isLoading ? (
        <div className="loading">
          <div className="spinner" />
        </div>
      ) : instances?.length === 0 ? (
        <div className="empty-state card">
          <h2>No instances yet</h2>
          <p>Create your first Vivd instance to get started.</p>
          <Link
            to="/create"
            className="btn btn-primary"
            style={{ marginTop: "1rem" }}
          >
            Create Instance
          </Link>
        </div>
      ) : (
        <div className="instance-grid">
          {instances?.map((instance) => (
            <div key={instance.id} className="card instance-card">
              <div className="instance-card-header">
                <div>
                  <div className="instance-name">{instance.name}</div>
                  <div className="instance-domain">
                    <a
                      href={`https://${instance.domain}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {instance.domain} <ExternalLink size={12} />
                    </a>
                  </div>
                </div>
                <span className={`instance-status ${instance.status}`}>
                  <span className={`status-dot ${instance.status}`} />
                  {instance.status}
                </span>
              </div>

              <div className="instance-meta">
                <span>Slug: {instance.slug}</span>
                {instance.singleProjectMode && <span>• Single Project</span>}
              </div>

              <div className="instance-actions">
                <button
                  className="btn btn-secondary"
                  onClick={() => handleRedeploy(instance.id)}
                  disabled={redeployMutation.isPending}
                >
                  <RefreshCcw size={14} />
                  {redeployMutation.isPending ? "Redeploying..." : "Redeploy"}
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => handleDelete(instance.id)}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
