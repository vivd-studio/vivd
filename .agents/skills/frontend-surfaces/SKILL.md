---
name: frontend-surfaces
description: Surface / elevation language and primitives for Vivd frontend. Use whenever you're about to add a container, panel, tile, callout, status chip, or form field — or before reaching for bg-muted/NN, bg-accent/NN, bg-card, rounded-xl border bg-*, bg-orange-50 dark:bg-orange-950, or any hand-rolled pill/well styling. Applies to packages/frontend and packages/studio.
---

# Frontend Surfaces

Vivd has one surface / elevation language. Every container, every tile, every
form field draws from the same small set of roles. This keeps the app visually
coherent across Super Admin, Organization, Studio, and plugin surfaces, even
when many people are editing at once.

If you're about to write `className="rounded-xl border bg-..."`, stop and use a
primitive.

## The surface roles

Five named roles. Each maps to a CSS variable that resolves per theme, so you
get the right shade automatically for every theme × light/dark combination.

| Role              | Tailwind class          | What it's for                                                 |
| ----------------- | ----------------------- | ------------------------------------------------------------- |
| `surface-page`    | `bg-surface-page`       | App canvas. The thing everything sits on.                     |
| `surface-panel`   | `bg-surface-panel`      | Primary elevated container — section shells, side rails.      |
| `surface-sunken`  | `bg-surface-sunken`     | Nested well inside a panel — stat tiles, inline regions.      |
| `surface-raised`  | `bg-surface-raised`     | Floating above everything — popovers, dropdowns, menus.       |
| `surface-input`   | `bg-surface-input`      | Form field background.                                        |

Rule of thumb: **panel sits on page, sunken sits on panel, raised floats
above.** Inputs are always `surface-input`.

Elevation direction flips between modes. In **light mode** sunken is *darker*
than panel (classic inset); in **dark mode** sunken is *lighter* than panel,
because the page is already the darkest layer and a darker-than-panel nested
surface reads as a hole, not a well. The primitives handle this for you —
don't try to pick bg classes by eye.

Definitions live in `packages/theme/theme.css` under the "Semantic Surface
Tokens" block. Do not edit per-theme values without also sanity-checking every
theme × light/dark combination visually.

## The primitives

Consume the roles through `@vivd/ui` primitives. Don't hand-roll surfaces.

### `<Panel>` — replaces ad-hoc Card usage

```tsx
import {
  Panel, PanelHeader, PanelTitle, PanelDescription, PanelContent, PanelFooter,
} from "@vivd/ui/panel";

<Panel>
  <PanelHeader>
    <PanelTitle>Organization Directory</PanelTitle>
    <PanelDescription>9 organizations across the platform.</PanelDescription>
  </PanelHeader>
  <PanelContent>…</PanelContent>
</Panel>

// Variants:
<Panel tone="sunken">…</Panel>   // well inside another Panel
<Panel tone="dashed">…</Panel>   // empty state
<PanelHeader separated>…</PanelHeader>  // border-b divider under header
```

### `<StatTile>` — the metric tile

```tsx
import {
  StatTile, StatTileLabel, StatTileValue, StatTileMeta, StatTileHelper,
} from "@vivd/ui/stat-tile";

<StatTile>
  <StatTileLabel>Monthly Credits <Icon /></StatTileLabel>
  <StatTileValue>3,661</StatTileValue>
  <StatTileMeta><span>of 20,000</span><span>18%</span></StatTileMeta>
  <Progress value={18} />
  <StatTileHelper>Monthly budget for generation and edits.</StatTileHelper>
</StatTile>
```

Pair with `<Progress>` from `@vivd/ui/progress` for bars.

### `<Callout>` — inline notice

```tsx
import { Callout, CalloutTitle, CalloutDescription } from "@vivd/ui/callout";
import { AlertTriangle } from "lucide-react";

<Callout tone="warn" icon={<AlertTriangle />}>
  <CalloutTitle>1 active warning</CalloutTitle>
  <CalloutDescription>Daily budget at 85%.</CalloutDescription>
</Callout>

// tones: info | warn | success | danger
```

Replaces every `rounded-xl border border-orange-200 bg-orange-50 dark:...`
and similar constructions.

### `<StatusPill>` — status chip

```tsx
import { StatusPill } from "@vivd/ui/status-pill";

<StatusPill tone="success">Active</StatusPill>
<StatusPill tone="warn">Not installed</StatusPill>
<StatusPill tone="danger">Blocked</StatusPill>
<StatusPill tone="neutral">Default</StatusPill>

// tones: neutral | info | success | warn | danger
// dot is optional and should be used sparingly, not as the default status treatment
```

Use for binary / enum status (Active, Deployed, Not deployed, Blocked, …).
Keep `<Badge>` for count / label chips. `StatusPill` now shares the same
compact squared chip geometry and height rhythm as `Badge`; the distinction is
semantic, not a separate rounded shape language.

### `<Table>` — dense data views

```tsx
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@vivd/ui/table";

<Panel tone="sunken" className="overflow-hidden p-0">
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>Project</TableHead>
        <TableHead>Status</TableHead>
        <TableHead>Updated</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow>
        <TableCell>Acme</TableCell>
        <TableCell><StatusPill tone="success">Deployed</StatusPill></TableCell>
        <TableCell>Apr 19</TableCell>
      </TableRow>
    </TableBody>
  </Table>
</Panel>
```

Use for real tabular data, especially admin/operator screens. The header band
should read as a control surface with stronger typography, but it should stay
within the surface stack, not collapse back to the row background or become a
near-black toolbar. Use the shared table-header treatment instead of inventing
one per screen.

### `<Field>` — form field shell

```tsx
import { Field, FieldLabel, FieldDescription, FieldError } from "@vivd/ui/field";
import { Input } from "@vivd/ui/input";

<Field>
  <FieldLabel htmlFor="slug" required>Slug</FieldLabel>
  <Input id="slug" value={slug} onChange={…} />
  <FieldDescription>URL-friendly identifier.</FieldDescription>
  <FieldError>{errors.slug?.message}</FieldError>
</Field>
```

Label `htmlFor` + control `id` stays the caller's responsibility — no hidden
wiring.

## Corner radii (codified)

| Element                                                | Radius        |
| ------------------------------------------------------ | ------------- |
| `Panel` — section containers                           | `rounded-xl`  |
| `StatTile`, inputs, buttons, `Callout`, `Badge`, `StatusPill` | `rounded-md`  |
| Everything else                                        | avoid         |

Do not mix `rounded-lg`, `rounded-2xl`, etc. on app-level code. Shift
inconsistencies toward the table above.

## Banned patterns

These are the constructions the surface system replaces. If you find yourself
reaching for one, swap in the primitive instead.

- `bg-muted/NN`, `bg-accent/NN`, `bg-background/NN`, `bg-card/NN` — invented
  opacity steps. Use a `Panel`/`StatTile`/`Callout` that targets the right
  role.
- `bg-card` or `bg-background` slapped on a hand-rolled container. Use
  `<Panel>`.
- `rounded-xl border bg-card p-4` / `rounded-lg border bg-background/70 p-4`
  constructions for stat tiles. Use `<StatTile>`.
- `rounded-md border bg-background px-2 py-1` status chips. Use `<StatusPill>`.
- Hand-rolled table headers like `thead className="bg-surface-*"` plus repeated
  `th`/`td` spacing classes. Use `<Table>` primitives so header contrast,
  label typography, and row states stay aligned.
- `rounded-xl border border-orange-200 bg-orange-50 dark:border-orange-900
  dark:bg-orange-950/30` warning boxes, and similar uses of raw tailwind color
  palettes (`bg-orange-*`, `bg-yellow-*`, `bg-red-*`, `text-orange-*`) for UI
  state. Use `<Callout>` with a tone.
- Status text styled with `text-red-500`, `text-orange-500`, `text-green-500`
  etc. — replace with `text-destructive`, `text-amber-600 dark:text-amber-400`,
  `text-emerald-600 dark:text-emerald-300`, or let the primitive handle it.
- Inline `<div className="space-y-1.5"><Label …/><Input …/></div>` form
  clusters. Use `<Field>`.

## Self-check

Before submitting UI changes, run:

```bash
rg -n "bg-(muted|accent|background|card|popover)(/\d+)?" packages/frontend/src
rg -n "bg-(muted|accent|background|card|popover)(/\d+)?" packages/studio/client/src
rg -n "bg-orange-|bg-yellow-|bg-red-" packages/frontend/src packages/studio/client/src
```

New hits in files you touched should go through primitives instead. Hits in
other files are the in-flight migration; leave them alone unless the task is
the migration itself.

## Scope & migration status

- Tokens live in `packages/theme/theme.css`.
- Tailwind aliases live in `packages/frontend/tailwind.config.js` and
  `packages/studio/client/tailwind.config.js` — must stay in sync.
- Primitives live in `packages/ui/src/{panel,stat-tile,callout,status-pill,field}.tsx`
  and are re-exported from `@vivd/ui`.
- The legacy aliases (`bg-card`, `bg-muted`, `bg-accent`) still resolve for
  now so existing code keeps working. They will be removed once migration is
  complete — at that point, only `bg-surface-*` will remain.

## When you're not sure

If the container you're building doesn't map cleanly to Panel / StatTile /
Callout / StatusPill / Field, that's a signal the primitive set is incomplete —
raise it rather than hand-rolling a new one-off. The whole point of the system
is that a new developer reading the code in six months sees five clear roles,
not forty.
