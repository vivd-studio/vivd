export const OPERATOR_STYLES = `
[data-tb-operator-mode="hc-light"] {
  color-scheme: light;
  --op-bg: #ffffff;
  --op-surface: #ffffff;
  --op-surface-raised: #f2f4f7;
  --op-border: #0f172a;
  --op-text: #000000;
  --op-text-muted: #1e293b;
  --op-text-subtle: #334155;
  --op-accent: #1d4ed8;
  --op-accent-contrast: #ffffff;
  --op-ok-fill: #15803d;
  --op-warn-fill: #b45309;
  --op-danger-fill: #991b1b;
  --op-danger-fg: #ffffff;
  --op-focus: #1d4ed8;
  --background: 0 0% 100%;
  --foreground: 0 0% 0%;
  --card: 0 0% 100%;
  --card-foreground: 0 0% 0%;
  --popover: 0 0% 100%;
  --popover-foreground: 0 0% 0%;
  --primary: 224 76% 48%;
  --primary-foreground: 0 0% 100%;
  --secondary: 220 17% 95%;
  --secondary-foreground: 0 0% 0%;
  --muted: 220 17% 95%;
  --muted-foreground: 215 19% 27%;
  --accent: 220 17% 95%;
  --accent-foreground: 0 0% 0%;
  --destructive: 0 70% 35%;
  --destructive-foreground: 0 0% 100%;
  --border: 222 47% 11%;
  --input: 222 47% 11%;
  --ring: 224 76% 48%;
  background: var(--op-bg);
  color: var(--op-text);
}

[data-tb-operator-mode="hc-dark"] {
  color-scheme: dark;
  --op-bg: #000000;
  --op-surface: #0b0f19;
  --op-surface-raised: #111827;
  --op-border: #f8fafc;
  --op-text: #ffffff;
  --op-text-muted: #e2e8f0;
  --op-text-subtle: #cbd5e1;
  --op-accent: #60a5fa;
  --op-accent-contrast: #000000;
  --op-ok-fill: #22c55e;
  --op-warn-fill: #f59e0b;
  --op-danger-fill: #ef4444;
  --op-danger-fg: #000000;
  --op-focus: #60a5fa;
  --background: 0 0% 0%;
  --foreground: 0 0% 100%;
  --card: 224 39% 7%;
  --card-foreground: 0 0% 100%;
  --popover: 224 39% 7%;
  --popover-foreground: 0 0% 100%;
  --primary: 213 94% 68%;
  --primary-foreground: 0 0% 0%;
  --secondary: 222 47% 11%;
  --secondary-foreground: 0 0% 100%;
  --muted: 222 47% 11%;
  --muted-foreground: 213 27% 84%;
  --accent: 222 47% 11%;
  --accent-foreground: 0 0% 100%;
  --destructive: 0 84% 60%;
  --destructive-foreground: 0 0% 0%;
  --border: 210 40% 98%;
  --input: 210 40% 98%;
  --ring: 213 94% 68%;
  background: var(--op-bg);
  color: var(--op-text);
}

[data-tb-operator-mode="hc-light"] .op-surface,
[data-tb-operator-mode="hc-dark"] .op-surface {
  background: var(--op-surface);
  color: var(--op-text);
  border: 2px solid var(--op-border);
}

[data-tb-operator-mode="hc-light"] .op-surface-raised,
[data-tb-operator-mode="hc-dark"] .op-surface-raised {
  background: var(--op-surface-raised);
  color: var(--op-text);
  border: 2px solid var(--op-border);
}

[data-tb-operator-mode="hc-light"] .op-muted,
[data-tb-operator-mode="hc-dark"] .op-muted {
  color: var(--op-text-muted);
}

[data-tb-operator-mode="hc-light"] .op-subtle,
[data-tb-operator-mode="hc-dark"] .op-subtle {
  color: var(--op-text-subtle);
}

[data-tb-operator-mode="hc-light"] .op-btn,
[data-tb-operator-mode="hc-dark"] .op-btn {
  min-height: 48px;
  background: var(--op-surface);
  color: var(--op-text);
  border: 2px solid var(--op-border);
  font-weight: 600;
}

[data-tb-operator-mode="hc-light"] .op-btn-primary,
[data-tb-operator-mode="hc-dark"] .op-btn-primary {
  background: var(--op-accent);
  color: var(--op-accent-contrast);
  border-color: var(--op-accent);
}

[data-tb-operator-mode="hc-light"] .op-btn-danger,
[data-tb-operator-mode="hc-dark"] .op-btn-danger {
  background: var(--op-danger-fill);
  color: var(--op-danger-fg);
  border-color: var(--op-danger-fill);
}

[data-tb-operator-mode="hc-light"] .op-btn:focus-visible,
[data-tb-operator-mode="hc-dark"] .op-btn:focus-visible {
  outline: 3px solid var(--op-focus);
  outline-offset: 2px;
}

[data-tb-operator-mode="hc-light"] .op-pill,
[data-tb-operator-mode="hc-dark"] .op-pill {
  border: 2px solid var(--op-border);
  color: var(--op-text);
  background: var(--op-surface);
}

[data-tb-operator-mode="hc-light"] .op-pill-ok,
[data-tb-operator-mode="hc-dark"] .op-pill-ok {
  background: var(--op-ok-fill);
  color: var(--op-accent-contrast);
  border-color: var(--op-ok-fill);
}

[data-tb-operator-mode="hc-light"] .op-pill-warn,
[data-tb-operator-mode="hc-dark"] .op-pill-warn {
  background: var(--op-warn-fill);
  color: var(--op-accent-contrast);
  border-color: var(--op-warn-fill);
}

[data-tb-operator-mode="hc-light"] .op-pill-danger,
[data-tb-operator-mode="hc-dark"] .op-pill-danger {
  background: var(--op-danger-fill);
  color: var(--op-danger-fg);
  border-color: var(--op-danger-fill);
}

@keyframes tb-operator-new-pulse {
  0% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.55); }
  70% { box-shadow: 0 0 0 12px rgba(34, 197, 94, 0); }
  100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
}
.op-row-new {
  animation: tb-operator-new-pulse 1.8s ease-out 2;
}
.op-freshness-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 999px;
}
.op-freshness-fresh { background: #22c55e; }
.op-freshness-warm  { background: #f59e0b; }
.op-freshness-stale { background: #ef4444; }
`;
