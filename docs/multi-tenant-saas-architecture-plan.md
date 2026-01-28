# Multi-Tenant SaaS Architecture Plan

## Übersicht

Dieses Dokument beschreibt den Plan zur Transformation von Vivid Studio von einer Single-Tenant-Instanz zu einem skalierbaren Multi-Tenant SaaS-Produkt, bei dem sich Kunden selbst registrieren und ihre eigenen isolierten Umgebungen bekommen.

## Das Kernproblem

Der OpenCode-basierte KI-Agent hat Zugriff auf:
- Bash-Befehle
- Dateisystem-Operationen (Lesen/Schreiben)

Dies macht echte Multi-Tenancy auf einem einzelnen Server ohne Isolation gefährlich. Der Agent könnte theoretisch auf Dateien anderer Tenants zugreifen.

**Vergleichbare Plattformen mit demselben Problem:**
- Replit
- GitHub Codespaces
- CodeSandbox
- StackBlitz

---

## Architektur-Entscheidung: Container-per-Tenant mit Fly.io Machines

### Warum dieser Ansatz?

| Ansatz | Sicherheit | Komplexität | Kosten | Solo-Dev tauglich |
|--------|------------|-------------|--------|-------------------|
| Shared Server + Sandboxing (gVisor) | Mittel | Hoch | Niedrig | ❌ |
| Container-per-Tenant (Fly.io) | Hoch | Mittel | Mittel | ✅ |
| VM-per-Tenant | Sehr hoch | Sehr hoch | Hoch | ❌ |
| Serverless Functions | Hoch | Mittel | Variable | ⚠️ (limitiert) |

**Fly.io Machines** bietet:
- Auto-suspend nach Inaktivität (keine Kosten wenn nicht genutzt)
- Auto-start bei eingehendem Request (~300ms)
- Einfache API für Provisioning
- Persistent Volumes für Dateien
- Keine Kubernetes-Komplexität

---

## Ziel-Architektur

```
┌─────────────────────────────────────────────────────────────────┐
│                    CONTROL PLANE (Hauptserver)                   │
│                        vivd.studio                               │
│                                                                  │
│  ┌────────────┐  ┌─────────────┐  ┌──────────┐  ┌────────────┐ │
│  │  Frontend  │  │  Auth API   │  │ Postgres │  │   Caddy    │ │
│  │  (Static)  │  │  Billing    │  │ (Users,  │  │ (Published │ │
│  │            │  │  Machines   │  │  Meta)   │  │   Sites)   │ │
│  └────────────┘  └──────┬──────┘  └──────────┘  └────────────┘ │
│                         │                                       │
└─────────────────────────┼───────────────────────────────────────┘
                          │
        ┌─────────────────┴─────────────────┐
        │     Machine Routing/Provisioning   │
        └─────────────────┬─────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
┌───────────────┐ ┌───────────────┐ ┌───────────────┐
│ Tenant Machine│ │ Tenant Machine│ │ Tenant Machine│
│   (User A)    │ │   (User B)    │ │   (User C)    │
│               │ │               │ │               │
│ ┌───────────┐ │ │ ┌───────────┐ │ │ ┌───────────┐ │
│ │ Project   │ │ │ │ Project   │ │ │ │ Project   │ │
│ │ API       │ │ │ │ API       │ │ │ │ API       │ │
│ ├───────────┤ │ │ ├───────────┤ │ │ ├───────────┤ │
│ │ OpenCode  │ │ │ │ OpenCode  │ │ │ │ OpenCode  │ │
│ │ Agent     │ │ │ │ Agent     │ │ │ │ Agent     │ │
│ ├───────────┤ │ │ ├───────────┤ │ │ ├───────────┤ │
│ │ Preview   │ │ │ │ Preview   │ │ │ │ Preview   │ │
│ │ Server    │ │ │ │ Server    │ │ │ │ Server    │ │
│ ├───────────┤ │ │ ├───────────┤ │ │ ├───────────┤ │
│ │ /projects │ │ │ │ /projects │ │ │ │ /projects │ │
│ │ (Volume)  │ │ │ │ (Volume)  │ │ │ │ (Volume)  │ │
│ └───────────┘ │ │ └───────────┘ │ │ └───────────┘ │
│  auto-suspend │ │  auto-suspend │ │  auto-suspend │
└───────────────┘ └───────────────┘ └───────────────┘
```

---

## Backend-Aufteilung

### Control Plane (Hauptserver - vivd.studio)

Bleibt auf dem zentralen Server:

```typescript
// Control Plane Routers
const controlPlaneRouters = {
  // Authentication & User Management
  auth: {
    login: publicProcedure,
    register: publicProcedure,
    logout: protectedProcedure,
    session: protectedProcedure,
  },

  // Billing & Subscriptions
  billing: {
    getSubscription: protectedProcedure,
    createCheckout: protectedProcedure,
    cancelSubscription: protectedProcedure,
    getUsage: protectedProcedure,
  },

  // Machine Management
  machines: {
    getMyMachine: protectedProcedure,      // → Machine URL für User
    provisionMachine: protectedProcedure,  // → Neue Machine erstellen
    getMachineStatus: protectedProcedure,  // → Running/Suspended
  },

  // Publishing (Caddy/Domain Management)
  publish: {
    registerDomain: protectedProcedure,
    unregisterDomain: protectedProcedure,
    listPublishedSites: protectedProcedure,
  },

  // Project Metadata (nicht die Dateien!)
  projectMeta: {
    list: protectedProcedure,              // → Projekt-Liste aus DB
    updateMeta: protectedProcedure,        // → Name, Description, etc.
  },
};
```

**Datenbank-Schema Erweiterungen:**

```sql
-- Neue Tabelle: Tenant Machines
CREATE TABLE tenant_machine (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id),
  fly_machine_id TEXT NOT NULL,
  fly_machine_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'stopped', -- 'running', 'stopped', 'starting'
  created_at TIMESTAMP DEFAULT NOW(),
  last_active_at TIMESTAMP,
  UNIQUE(user_id)
);

-- Projekt-Metadaten (ohne Datei-Inhalte)
CREATE TABLE project_meta (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id),
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP,
  UNIQUE(user_id, slug)
);
```

### Data Plane (Tenant Machine - tenant-xxx.fly.dev)

Wandert auf die Tenant-Machine:

```typescript
// Data Plane Routers (auf der Machine)
const dataPlaneRouters = {
  // Projekt-Operationen (Dateisystem)
  project: {
    list: protectedProcedure,           // → Projekte aus /projects lesen
    get: protectedProcedure,            // → Projekt-Details
    create: protectedProcedure,         // → Neues Projekt anlegen
    delete: protectedProcedure,         // → Projekt löschen
  },

  // Datei-Operationen
  files: {
    read: protectedProcedure,           // → Datei lesen
    write: protectedProcedure,          // → Datei schreiben
    list: protectedProcedure,           // → Verzeichnis listen
    upload: protectedProcedure,         // → Bild hochladen
    delete: protectedProcedure,         // → Datei löschen
  },

  // Preview
  preview: {
    getUrl: protectedProcedure,         // → Preview URL
    // Static serving über Express middleware
  },

  // OpenCode Agent
  agent: {
    sendMessage: protectedProcedure,    // → Nachricht an Agent
    getHistory: protectedProcedure,     // → Chat-Verlauf
    cancel: protectedProcedure,         // → Agent abbrechen
    // WebSocket für Streaming
  },

  // Generation (Scraping, AI)
  generation: {
    scrapeWebsite: protectedProcedure,  // → Website scrapen
    regenerate: protectedProcedure,     // → Neu generieren
    getStatus: protectedProcedure,      // → Generation-Status
  },

  // Version Management
  versions: {
    list: protectedProcedure,
    create: protectedProcedure,
    switch: protectedProcedure,
    delete: protectedProcedure,
  },
};
```

---

## Frontend-Änderungen

### Dual-API Client Setup

```typescript
// lib/api.ts

// Control Plane API (immer vivd.studio)
export const controlPlaneApi = createTRPCClient<ControlPlaneRouter>({
  links: [
    httpBatchLink({
      url: 'https://vivd.studio/api/trpc',
      headers: () => ({
        Authorization: `Bearer ${getToken()}`,
      }),
    }),
  ],
});

// Data Plane API (dynamisch - Tenant Machine)
let dataPlaneClient: ReturnType<typeof createTRPCClient<DataPlaneRouter>> | null = null;

export function getDataPlaneApi() {
  if (!dataPlaneClient) {
    const machineUrl = getMachineUrl(); // Aus Session/LocalStorage
    dataPlaneClient = createTRPCClient<DataPlaneRouter>({
      links: [
        httpBatchLink({
          url: `${machineUrl}/trpc`,
          headers: () => ({
            Authorization: `Bearer ${getToken()}`,
          }),
        }),
      ],
    });
  }
  return dataPlaneClient;
}

// WebSocket für Agent-Streaming
export function connectToAgentWebSocket() {
  const machineUrl = getMachineUrl();
  return new WebSocket(`${machineUrl.replace('https', 'wss')}/ws/agent`);
}
```

### Login-Flow mit Machine-Provisioning

```typescript
// hooks/useAuth.ts

async function login(email: string, password: string) {
  // 1. Login beim Control Plane
  const session = await controlPlaneApi.auth.login.mutate({ email, password });

  // 2. Machine-URL holen (oder provisionieren)
  let machine = await controlPlaneApi.machines.getMyMachine.query();

  if (!machine) {
    // Erste Anmeldung: Machine erstellen
    machine = await controlPlaneApi.machines.provisionMachine.mutate();
  }

  // 3. Machine-URL speichern
  localStorage.setItem('machineUrl', machine.url);

  // 4. Warten bis Machine läuft (falls suspended)
  if (machine.status === 'stopped') {
    await waitForMachineStart(machine.id);
  }

  // 5. Data Plane Client initialisieren
  initDataPlaneClient(machine.url);

  return session;
}
```

### Preview iframe

```tsx
// components/Preview.tsx

function Preview({ projectSlug }: { projectSlug: string }) {
  const machineUrl = useMachineUrl();

  return (
    <iframe
      src={`${machineUrl}/preview/${projectSlug}`}
      className="w-full h-full"
    />
  );
}
```

---

## Fly.io Machine Management

### Machine Provisioning

```typescript
// services/FlyMachineService.ts

import { Fly } from '@anthropic/fly-sdk'; // oder direkter API-Call

const fly = new Fly({ token: process.env.FLY_API_TOKEN });

export class FlyMachineService {

  async provisionMachine(userId: string): Promise<TenantMachine> {
    // 1. Machine erstellen
    const machine = await fly.machines.create({
      app: 'vivd-tenants',
      config: {
        image: 'ghcr.io/vivd-studio/tenant:latest',
        size: 'shared-cpu-1x',  // 256MB RAM

        // Auto-suspend nach 5 Minuten Inaktivität
        auto_destroy: false,
        services: [{
          ports: [{ port: 443, handlers: ['tls', 'http'] }],
          internal_port: 3000,
          auto_stop_machines: true,
          auto_start_machines: true,
          min_machines_running: 0,
        }],

        // Environment
        env: {
          TENANT_ID: userId,
          CONTROL_PLANE_URL: 'https://vivd.studio',
          R2_BUCKET: process.env.R2_BUCKET,
          R2_ACCESS_KEY: process.env.R2_ACCESS_KEY,
          R2_SECRET_KEY: process.env.R2_SECRET_KEY,
        },

        // Persistent Volume für Projekte
        mounts: [{
          volume: await this.createVolume(userId),
          path: '/projects',
        }],
      },
      metadata: {
        tenant_id: userId,
      },
    });

    // 2. In DB speichern
    const tenantMachine = await db.insert(tenantMachineTable).values({
      id: generateId(),
      userId,
      flyMachineId: machine.id,
      flyMachineUrl: `https://${machine.id}.fly.dev`,
      status: 'running',
    }).returning();

    return tenantMachine;
  }

  async createVolume(userId: string): Promise<string> {
    const volume = await fly.volumes.create({
      app: 'vivd-tenants',
      name: `vol-${userId}`,
      size_gb: 5,  // 5GB pro Tenant
      region: 'fra',  // Frankfurt
    });
    return volume.id;
  }

  async getMachineStatus(machineId: string): Promise<'running' | 'stopped' | 'starting'> {
    const machine = await fly.machines.get(machineId);
    return machine.state;
  }

  async wakeMachine(machineId: string): Promise<void> {
    await fly.machines.start(machineId);
    // Warten bis ready
    await this.waitForState(machineId, 'started');
  }
}
```

### Tenant Machine Docker Image

```dockerfile
# Dockerfile.tenant
FROM node:20-slim

WORKDIR /app

# Nur Data Plane Code
COPY packages/data-plane/dist ./dist
COPY packages/data-plane/package.json ./

RUN npm install --production

# OpenCode Installation
RUN npm install -g opencode

# Projekte-Verzeichnis (wird von Volume gemountet)
RUN mkdir -p /projects

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "dist/server.js"]
```

---

## Datei-Synchronisation (Backup)

### Background Sync zu R2

Die Dateien leben primär auf dem Fly Volume. R2 dient als Backup und für Publishing.

```typescript
// services/SyncService.ts (auf der Tenant Machine)

export class SyncService {
  private syncInterval: NodeJS.Timer | null = null;

  start() {
    // Sync alle 5 Minuten
    this.syncInterval = setInterval(() => {
      this.syncToR2();
    }, 5 * 60 * 1000);

    // Sync bei Shutdown
    process.on('SIGTERM', async () => {
      await this.syncToR2();
      process.exit(0);
    });
  }

  async syncToR2() {
    const tenantId = process.env.TENANT_ID;

    await exec(`rclone sync /projects r2:vivd-backup/${tenantId}/projects \
      --checksum \
      --exclude "node_modules/**" \
      --exclude ".git/**"`);

    console.log(`Synced to R2 for tenant ${tenantId}`);
  }

  // Wird aufgerufen wenn Machine startet und Volume leer ist
  async restoreFromR2() {
    const tenantId = process.env.TENANT_ID;

    // Prüfen ob lokale Daten existieren
    const hasLocalData = await fs.exists('/projects/.initialized');
    if (hasLocalData) return;

    // Von R2 wiederherstellen
    await exec(`rclone sync r2:vivd-backup/${tenantId}/projects /projects`);
    await fs.writeFile('/projects/.initialized', new Date().toISOString());
  }
}
```

---

## Publishing Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                       Publishing Flow                            │
└─────────────────────────────────────────────────────────────────┘

1. User klickt "Publish" im Frontend
   │
   ▼
2. Request an Tenant Machine: POST /trpc/project.build
   │
   └──► Tenant Machine baut das Projekt (astro build o.ä.)
   │
   ▼
3. Tenant Machine synct Build-Output zu R2
   │
   └──► rclone sync /projects/site/dist r2:vivd-published/{userId}/{projectSlug}/
   │
   ▼
4. Tenant Machine meldet Fertigstellung an Control Plane
   │
   └──► POST vivd.studio/api/trpc/publish.notifyBuildComplete
   │
   ▼
5. Control Plane aktualisiert Caddy Config
   │
   └──► Domain → R2 Bucket (oder lokaler Cache)
   │
   ▼
6. Site ist live unter custom-domain.com
```

---

## Kosten-Kalkulation

### Fly.io Machines

| Resource | Preis | Notizen |
|----------|-------|---------|
| shared-cpu-1x (256MB) | $0.0000022/s | ~$5.70/Monat wenn 24/7 |
| Mit Auto-suspend | ~$1-2/Monat | Bei 2h/Tag Nutzung |
| Fly Volume (5GB) | $0.75/Monat | Pro Tenant |

### Cloudflare R2

| Resource | Preis |
|----------|-------|
| Storage | $0.015/GB/Monat |
| Class A Operations | $4.50/Million |
| Class B Operations | $0.36/Million |
| Egress | Kostenlos |

### Beispielrechnung: 100 User

| Posten | Kosten/Monat |
|--------|--------------|
| Control Plane Server | $50 |
| 100 Tenant Machines (2h/Tag avg) | $150-200 |
| 100 Fly Volumes (5GB) | $75 |
| R2 Storage (500GB total) | $7.50 |
| R2 Operations | ~$5 |
| **Gesamt** | **~$290-340** |

**Pro User:** ~$3-3.40/Monat Infrastrukturkosten

---

## Implementierungs-Phasen

### Phase 1: Backend-Splitting (2-3 Wochen)

- [ ] tRPC Router aufteilen in Control Plane / Data Plane
- [ ] Separates Package für Data Plane erstellen
- [ ] Docker Image für Tenant Machine
- [ ] Lokaler Test mit zwei getrennten Prozessen

### Phase 2: Fly.io Integration (1-2 Wochen)

- [ ] Fly.io Account & App Setup
- [ ] FlyMachineService implementieren
- [ ] Machine Provisioning bei User-Registrierung
- [ ] Auto-suspend/Auto-start testen

### Phase 3: Frontend-Anpassungen (1-2 Wochen)

- [ ] Dual-API Client Setup
- [ ] Login-Flow mit Machine-URL
- [ ] Preview iframe auf Machine-URL umstellen
- [ ] WebSocket-Verbindung zur Machine

### Phase 4: Sync & Backup (1 Woche)

- [ ] R2 Bucket Setup
- [ ] SyncService auf Tenant Machine
- [ ] Restore-Logic bei Machine-Start
- [ ] Publishing Flow anpassen

### Phase 5: Billing & Self-Registration (2 Wochen)

- [ ] Stripe Integration
- [ ] Subscription Tiers
- [ ] Usage-basierte Limits pro Tenant
- [ ] Self-Registration Flow

### Phase 6: Monitoring & Hardening (1 Woche)

- [ ] Logging/Monitoring Setup
- [ ] Error Handling
- [ ] Rate Limiting
- [ ] Security Review

---

## Offene Fragen

1. **Scraper Service:** Bleibt zentral oder pro Tenant?
   - Empfehlung: Zentral, da stateless und gut teilbar

2. **OpenCode Sessions:** Pro Projekt oder pro Tenant?
   - Aktuell: Pro Projekt-Verzeichnis
   - Sollte so bleiben können

3. **Client-Editor Rolle:** Wie funktioniert das mit separaten Machines?
   - Option A: Client-Editor bekommt temporären Zugriff auf Owner-Machine
   - Option B: Eigene Machine (teurer)
   - Empfehlung: Option A mit scoped Token

4. **Cold Start Latenz:** 300ms akzeptabel?
   - Für Dashboard/Projekt-Liste: Ja
   - Für Preview während Editing: Könnte störend sein
   - Lösung: Machine aktiv halten während aktiver Session

---

## Referenzen

- [Fly.io Machines Documentation](https://fly.io/docs/machines/)
- [Fly.io Auto-stop/Auto-start](https://fly.io/docs/apps/autostart-stop/)
- [Cloudflare R2 Pricing](https://developers.cloudflare.com/r2/pricing/)
- [rclone R2 Setup](https://rclone.org/s3/#cloudflare-r2)
