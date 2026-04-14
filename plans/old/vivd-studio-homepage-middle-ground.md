# vivd.studio Homepage Draft (Hybrid Product + Services)

Date: 2026-03-25  
Status: proposed copy + structure  
Audience: current `vivd.studio` visitors, agency leads, early product users, self-host evaluators

## Goal

Keep `vivd.studio` usable for the already printed cards while shifting the root domain away from a pure agency landing page and toward the actual Vivd product.

This is intentionally a middle-ground version:

- `vivd.studio` stays the umbrella entry point.
- The homepage becomes clearly product-first.
- Services stay visible, but only as a subtle secondary option.
- The more agency-heavy sections move to `/services` over time.

## Important Constraint

The current site repo under `vendor/sites/default-vivd-studio-2-v1-v1` is an agency landing page in structure and copy:

- nav centers `Leistungen`, `Unser Prozess`, `Portfolio`, `Preis anfragen`
- hero centers done-for-you web design/development
- core sections are industries, services, process, testimonials, portfolio, contact

That means the simplest transition is not a full redesign first. The simpler move is:

1. change the top-level story and CTAs on `/`
2. keep one light service path
3. move the agency-heavy proof/contact flow to `/services`

## Recommended Site Split

- `vivd.studio/`: hybrid homepage
- `vivd.studio/services`: agency/services page
- `app.vivd.studio`: hosted product entry
- `docs.vivd.studio`: product docs

## Confirmed Direction

The following product/IA decisions are now the preferred direction:

- `Vivd` is the product/platform brand.
- `Vivd Studio` is the working environment inside the product.
- `Angebot anfragen` does not belong on the root page.
- Portfolio and testimonials do not belong on the root page.
- Portfolio / case studies should live on `/services` only.
- `/services` should only show real projects that actually run on Vivd.
- Do not use fake testimonials or fake references.

## Language, Theme, and Brand Behavior

The root site should feel like part of the Vivd product ecosystem, not like a disconnected marketing microsite.

### Language

- the full page should exist in German and English
- on first visit, auto-detect language from browser preference
- if the user manually switches language, persist that choice and do not auto-flip again
- keep a visible DE/EN toggle in the header
- do not ship half-translated sections; both languages should be complete

### Theme

- support both light and dark mode
- follow system preference on first load
- persist manual light/dark override
- use `vivd-sharp` as the baseline visual language across both modes

Notes:

- `vivd-sharp` already exists in the shared theme system and is the right reference for the root page because it is high-contrast, crisp, and recognizably Vivd.
- the product page should feel sharper and more graphic than the current agency site

### Brand Motif

- bring back the transparent `V` icon on a dark gray surface as a recurring accent
- use it sparingly: hero badge, section marker, floating chip, or footer stamp
- do not turn it into decorative noise; it should feel intentional and product-like

### Services Page Visual Direction

- yes, `/services` can and should look somewhat different
- keep the same brand family, but make it slightly warmer, more editorial, and more human
- product root: sharper, more UI/product-system-driven
- services page: more case-study, photography, and proof-driven
- shared elements should remain consistent: logotype, green accent, icon, typography family, and core spacing discipline

Later, if desired:

- `solutions.vivd.studio` can become the services home
- `vivd.studio/services` can then redirect there

## What Should Move Off The Homepage

These sections should not stay as major root-page blocks long term:

- large agency-first portfolio section
- generic testimonials
- long “our process” agency sales flow
- full contact form as the main conversion destination

Notes:

- If the current portfolio/testimonial content is placeholder or composite material, do not keep it as primary proof on the root domain.
- On the root page, trust should come from product clarity, screenshots, docs, self-hosting, and a compact services offer.

## Homepage Structure

Order matters. The page should answer:

1. What is Vivd?
2. Is this a product or a service?
3. Can I use it myself?
4. Can you do it for me?
5. Why should I trust it?

## Positioning Principle

The homepage should not present product and services as two equally weighted offers.

Instead:

- the main message is `Vivd = product/platform`
- the main actions are product actions
- the service angle appears as a soft fallback for people who want help

A good mental model:

- primary: `Use Vivd`
- secondary: `Read docs` / `Self-host`
- tertiary: `Or let us build it for you`

## Reference Synthesis

The current direction should deliberately borrow different strengths from OpenClaw and n8n rather than imitating either one.

### What To Take From OpenClaw

- blunt hero clarity
- strong self-host / local-control confidence
- product language that feels operator-credible instead of marketing-soft
- compact capability framing that quickly answers `what can this actually do?`

### What To Take From n8n

- cleaner landing-page hierarchy
- clearer product-story sequencing from hero to capabilities to control/trust to final CTA
- stronger emphasis on flexibility and ownership without becoming overly technical too early
- more disciplined sectioning and scannability

### What To Adapt For Vivd

- Vivd should use OpenClaw-style directness in the hero and trust story
- Vivd should use n8n-style information architecture for the page flow
- Vivd should remain less sales-heavy than n8n on the root page until there is deeper real proof

### What Not To Copy

- do not copy OpenClaw-style social proof volume unless there is real proof to support it
- do not copy n8n-style enterprise/sales pressure on the root page
- do not present Vivd as a generic AI tool; it must stay clearly about websites, Studio, and publishing

## Header

Recommended nav:

- Produkt
- Self-Hosting
- FAQ
- Docs
- App starten

Header CTA:

- Primary: `App starten`
- Secondary text link in a utility row or near the CTAs: `Von uns umsetzen lassen`

This keeps the product path primary while still serving agency leads quietly.

Important:

- do not use `Angebot anfragen` in the main header
- if a stronger sales CTA is needed, place it on `/services`

## Hero

### Eyebrow

`Die fair-code KI-Website-Plattform`

English variant:

`The fair-code AI website platform`

### Headline

`Vom Prompt zur veröffentlichten Website in einem Studio.`

English variant:

`From prompt to published website in one studio.`

### Subheadline

`Lass KI an deiner Website arbeiten und veröffentliche sie, ohne Vivd Studio zu verlassen.`

English variant:

`Talk to AI, work in the real project, and publish without leaving Vivd Studio.`

### Primary CTAs

- `App starten`
- `Docs lesen`

### Secondary Links

- `Self-Hosting ansehen`
- `Von uns bauen lassen`

### Trust Row

- `Fair-code`
- `Self-hostable`
- `Studio + Publishing`

### Hero Notes

- Keep the current visual direction from the existing hero. It already has product-shaped visuals.
- Change the copy first; the visuals can stay while the information architecture changes.
- The service CTA here should feel like a quiet escape hatch, not like the main point of the page.
- The hero should feel closer to OpenClaw in directness and closer to n8n in structure.

## Root Page V1 Plan

The root page should be reduced to a tighter product-first structure.

### Section 1: Hero

Purpose:

- make the product instantly legible
- make `Vivd Studio` legible
- keep services visible but quiet

Content:

- eyebrow
- H1
- subheadline
- product CTAs
- subtle service link
- one small visual trust row

### Section 2: What You Can Do With Vivd

Purpose:

- answer `what does this actually do?` quickly

Suggested cards:

- `Import an existing site`
- `Start from scratch`
- `Edit in Vivd Studio`
- `Publish or self-host`

This is the place to apply OpenClaw-style capability clarity.

### Section 3: How Vivd Works

Purpose:

- explain the product model without hand-waving

Suggested message:

- prompt or import
- AI works in Vivd Studio
- Studio operates on the real project
- publishing is built in

This is where the line between Vivd and Vivd Studio should become very clear.

### Section 4: Control, Fair-Code, and Self-Hosting

Purpose:

- give the user confidence that this is a real platform, not a black box

Suggested topics:

- fair-code
- self-hostable
- real project workspace
- publishing on your own domain

This is where the OpenClaw-inspired operator-confidence and the n8n-style control framing should show up most strongly.

### Section 5: Small Services Teaser

Purpose:

- keep the existing agency path alive without turning the root page into a services page

Rules:

- short block only
- no inquiry form
- no giant sales CTA
- route to `/services`

### Section 6: Product FAQ

Purpose:

- answer product questions, not agency procurement questions

Suggested themes:

- what Vivd is
- what Vivd Studio is
- self-hosting
- ownership / publishing

### Section 7: Final CTA

Purpose:

- close on product momentum

Primary CTA:

- `App starten`

Secondary CTAs:

- `Docs lesen`
- `Self-Hosting ansehen`

Tertiary:

- `Services ansehen`

## Section 2: Choose Your Path

### Section Label

`Mit Vivd arbeiten`

### Headline

`Nutzen Sie Vivd selbst. Oder holen Sie sich Unterstützung, wenn Sie sie brauchen.`

### Intro

`Vivd ist zuerst eine Plattform. Für Teams, Betreiber und Selbstständige, die schneller zu einer hochwertigen Website kommen wollen. Wenn Sie keine eigene Zeit in Struktur, Inhalte oder Launch stecken möchten, kann Vivd Solutions einspringen.`

### Card 1

Title:

`Vivd selbst nutzen`

Text:

`Erstellen Sie Websites in Vivd Studio, arbeiten Sie mit KI direkt im Projekt und veröffentlichen Sie auf Ihrer Domain. Ideal für Teams, Maker und Betreiber, die selbst Kontrolle behalten wollen.`

CTA:

`Vivd entdecken`

Supporting links:

- `App starten`
- `Docs`
- `Self-Hosting`

### Card 2

Title:

`Unterstützung durch uns`

Text:

`Wenn Sie keine Zeit für Inhalte, Struktur, Design oder laufende Pflege haben, übernimmt Vivd Solutions die Umsetzung für Sie.`

CTA:

`Mehr dazu`

Supporting links:

- `Projekt anfragen`
- `Erstgespräch vereinbaren`

## Section 3: What Vivd Is

### Headline

`Eine Website-Plattform statt zehn einzelner Tools.`

### Intro

`Mit Vivd starten Sie aus einem Briefing, einer Referenzseite oder einer Idee. Danach arbeiten Sie in Studio weiter: mit KI, Vorschau, echten Projektdateien, Assets, Plugins und Publishing an einem Ort.`

### Three Columns

#### Column 1

Title:

`Mit KI starten`

Text:

`Aus einer Idee, einem Screenshot oder einer bestehenden Website entsteht ein erster Entwurf, mit dem Sie sofort weiterarbeiten können.`

#### Column 2

Title:

`In Studio verfeinern`

Text:

`Vivd Studio arbeitet im echten Projekt statt in einer Spielzeug-Oberfläche. Inhalte, Struktur, Dateien, Assets und Vorschau gehören zum selben Workflow.`

#### Column 3

Title:

`Veröffentlichen oder selbst hosten`

Text:

`Sie können Websites direkt veröffentlichen oder Vivd auf Ihrer eigenen Infrastruktur betreiben.`

### CTA Row

- `Docs lesen`
- `Self-Hosting ansehen`

## Section 4: How It Works

### Headline

`So funktioniert Vivd`

### Step 1

Title:

`1. Briefing oder Referenz eingeben`

Text:

`Beschreiben Sie Ihre Website, laden Sie Inhalte hoch oder geben Sie eine bestehende Referenzseite vor.`

### Step 2

Title:

`2. Mit KI in Studio weiterarbeiten`

Text:

`Verfeinern Sie Design, Seiten, Inhalte und Bilder direkt im Projekt. Keine Tool-Wechsel, keine Übergabe zwischen Systemen.`

### Step 3

Title:

`3. Live schalten`

Text:

`Veröffentlichen Sie auf Ihrer Domain, arbeiten Sie weiter in Studio oder betreiben Sie Vivd self-hosted.`

### CTA

`Vivd entdecken`

## Section 5: Services Teaser

This replaces the current large agency-heavy middle of the page with one compact commercial block.

### Eyebrow

`Optional: Umsetzung durch Vivd Solutions`

### Headline

`Keine Zeit, es selbst aufzusetzen?`

### Body

`Dann setzen wir Ihre Website auf Basis von Vivd für Sie um. Sie bekommen das Ergebnis und können später trotzdem auf derselben Grundlage weiterarbeiten.`

### Bullets

- `Strategie, Struktur und Copy`
- `Design und Umsetzung`
- `Launch, Hosting und laufende Pflege`

### CTA

- `Services ansehen`
- `Zur Services-Seite`

### Placement Note

This block should appear before FAQ and before the final CTA, but after the product explanation.

The CTA here should route to `/services`, not to a root-page inquiry form.

## Section 6: Self-Hosting / Fair-Code

### Headline

`Vivd ist fair-code und self-hostable.`

### Body

`Wenn Sie Vivd selbst betreiben möchten, können Sie das tun. Die öffentliche Dokumentation erklärt das Produkt, die Architektur und den aktuellen Self-Hosting-Pfad.`

### Supporting Copy

`Für Einzelteams und eigene Nutzung ist der Self-Hosting-Pfad direkt Teil der Produktstory. Für größere kommerzielle Plattform- oder Agenturmodelle gelten die Lizenzgrenzen aus Vivd selbst.`

### CTA

- `Self-Hosting lesen`
- `Docs öffnen`

## FAQ Strategy

Use two distinct FAQ surfaces with different intent.

### Root Page FAQ

- product-focused
- answers how Vivd works
- should be the main FAQ block

### Services FAQ

- services-focused
- answers delivery, collaboration, handoff, and support questions
- should live on `/services`

### Optional Mini FAQ Near Services Teaser

Only if needed:

- max 3 questions
- acts as a bridge to `/services`
- should not become a second main accordion on the root page

### Q1

`Ist Vivd ein Produkt oder eine Dienstleistung?`

Answer:

`Beides. Sie können Vivd selbst nutzen oder Vivd Solutions mit der Umsetzung Ihrer Website beauftragen.`

### Q2

`Muss ich mich selbst um Inhalte und Design kümmern?`

Answer:

`Nein. Wenn Sie Vivd selbst nutzen, unterstützt Sie Studio mit KI und Bearbeitungswerkzeugen. Wenn Sie lieber auslagern möchten, übernimmt Vivd Solutions den Prozess für Sie.`

### Q3

`Kann ich Vivd selbst hosten?`

Answer:

`Ja. Vivd ist fair-code und self-hostable. Die Details zum aktuellen Setup finden Sie in den öffentlichen Docs.`

### Q4

`Kann ich erst mit Services starten und später selbst übernehmen?`

Answer:

`Ja. Genau dafür ist die Mischform sinnvoll. Wir können die Website initial für Sie aufsetzen, während Vivd gleichzeitig die Grundlage bleibt, auf der Sie später selbst weiterarbeiten können.`

## Final CTA

### Headline

`Starten Sie mit Vivd auf dem Weg, der für Sie passt.`

### Body

`Ob Sie selbst mit KI bauen, self-hosten oder die Umsetzung direkt abgeben möchten: Vivd deckt alle drei Wege ab.`

### CTAs

- `App starten`
- `Services ansehen`
- `Docs lesen`

## Footer Structure

Group links explicitly into product and services.

### Product

- `Vivd`
- `App`
- `Docs`
- `Self-Hosting`

### Services

- `Vivd Solutions`
- `Services`
- `Ablauf`
- `Kontakt`

### Legal

- `Impressum`
- `Datenschutz`
- `AGB`
- `Lizenz`

## Suggested Short Copy Variant For The Hero

If the full hero above feels too heavy, use this shorter variant:

### Headline

`From prompt to published website in one studio.`

### Text

`Talk to AI, work in the real project, and publish without leaving Vivd Studio.`

### CTAs

- `App starten`
- `Docs lesen`

### Quiet Service Link

`Oder lassen Sie es von uns bauen`

## What To Reuse From The Current Site

- hero visual direction
- overall visual language
- clean white/green/black palette
- compact FAQ patterns
- legal infrastructure

## What To Replace First

Priority order:

1. nav labels and CTAs
2. hero copy
3. make the root-page hero match the approved `one studio` positioning
4. make service CTA visually quieter than product CTAs
5. rebuild the first section after hero around product capabilities
6. remove portfolio/testimonials from the root page entirely
7. remove root-page inquiry framing such as `Angebot anfragen`
8. replace long agency-middle with compact services teaser
9. move contact-heavy sales flow to `/services`

## Suggested `/services` Structure

This is where the existing agency material should go with lighter edits:

1. hero: `Professionelle Websites für Unternehmen, umgesetzt mit Vivd`
2. services / benefits
3. industries / fit
4. process
5. real case studies only
6. real testimonials only, if they actually exist and are attributable
7. services FAQ
8. contact / inquiry form

Rules for `/services`:

- only show projects that are truly live on Vivd
- no placeholders, composites, or speculative showcase work
- better to show fewer strong references than many weak or fake ones

Visual notes for `/services`:

- allow a somewhat different tone from the root page
- less product-UI chrome, more proof and human context
- darker photography or softer editorial surfaces can work well there
- still keep light/dark support and the same core brand tokens

## Implementation Order

This is the most sensible execution order for the actual site repo:

1. rework shared layout, theme, and language handling
2. rebuild the root page around the approved hero and V1 section order
3. remove root portfolio/testimonials/contact-form dependencies
4. create `/services` as the destination for the agency path
5. move only the truly valid proof and inquiry flow there
6. polish light/dark and DE/EN behavior after structure is stable

## One-Sentence Positioning

If a single sentence is needed across the site, cards, or metadata:

`Vivd ist die fair-code KI-Plattform für moderne Websites – mit optionaler Umsetzung durch Vivd Solutions.`
