# MyCity Piacenza — Design System

**"Mediterranean Modern"** — the design language of **MyCity**, a marketplace for the local shops of **Piacenza, Italy**, with home delivery. Buyers browse real neighbourhood shops, order in a few taps, and **pay the rider on delivery** ("paga alla consegna"). One product, four roles: **buyer · seller · rider · admin**.

The palette is drawn from the Italian kitchen and market — terracotta roof tiles, plastered cream walls, saffron mustard, the olive green of the Piacentine hills, typographic ink. It deliberately rejects cold "B2B SaaS" indigo/grey for something **warm, local, authentic**.

## Sources
This system was reverse-engineered from the product's own codebase. Explore it to build with higher fidelity:

- **GitHub:** `https://github.com/NicolaeRotaru/mycity` (private) — Next.js 14 + Supabase + Stripe. The design language lives in `tailwind.config.ts` ("Mediterranean Modern"), `app/globals.css`, and the `components/ui/*` primitives (`Button`, `Badge`, `Card`, `Modal`, `Field`).

The real product copy is **Italian**; this guide keeps brand copy in Italian and explains tone below.

---

## Content fundamentals

**Language:** Italian, throughout. Brand voice is **warm, direct, reassuring, neighbourly** — a trusted shopkeeper, not a tech platform.

- **Address the reader as "tu"** (informal). "I negozi veri di Piacenza, **ora a casa tua**." "Cambi idea? **Ti rimborsiamo** senza domande."
- **Lead with the reassurance, not the feature.** The #1 hook is always risk-removal: *paghi alla consegna*, *zero rischi*, *l'account serve solo per confermare l'ordine*. Honesty is explicit ("il framing è ONESTO").
- **Concrete & local.** Names places and products: "i commercianti della tua via", "Coppa Piacentina DOP", "verde dei colli piacentini", "Piacenza · 29121". Numbers are specific: "24–48h", "€5 di sconto", "Reso entro 14 giorni".
- **Sentence case** for almost everything; headlines too. UPPERCASE is reserved for tiny eyebrows and micro-badges ("I PIÙ AMATI", "-30%"), always with wide tracking.
- **Headlines** are short, declarative, often two-part with a line break and one italic emphasis word in terracotta: "I negozi *veri* di Piacenza, / ora a casa tua." "Ordini dai negozi di Piacenza. / *Paghi alla consegna.*"
- **Emoji:** essentially **none in product UI** — the codebase explicitly removed status emoji in favour of Lucide icons ("Emoji + Lucide mixati distruggono brand coherence"). Emoji appear only in lightweight marketing surfaces like the promo ticker.
- **Punctuation:** Italian typographic apostrophes/quotes ('è', "..."); "·" as a separator in meta lines.

---

## Visual foundations

**Colour.** Terracotta `primary` (#C0492C) is the brand; mustard `accent` (#E8A33D) is the high-intent *purchase* CTA; olive `success` (#5A7C42) signals "fresh / positive"; wine `secondary` (#B82A28) carries discounts, urgency and favourites; `ink` is warm charcoal text. Two backgrounds coexist by **funnel stage**: warm **cream** (#FBF7F0) for discovery/editorial surfaces, neutral **surface** whites/stone for the purchase funnel (home → product → checkout) so **photos pop** without a yellow cast. The navbar is a solid terracotta band with mustard accents.

**Type.** **Fraunces** (serif, "Soft" optical axis) for all display — h1–h3, hero, editorial prices — set tight (-0.01em) with a stretched 1.05 line-height; the hero italic emphasis word is Fraunces italic. **Inter** for everything else: body, labels, buttons, data. Body is 16px (no iOS zoom). Eyebrows are 12px Inter, bold, uppercase, wide-tracked.

**Shape & depth.** Soft, artisanal radii — buttons `md` (8px), cards `lg`–`2xl` (12–20px), pills `full`. Cards are white with a 1px cream border; "elevated" adds a **warm-tinted shadow** (terracotta rgba), never a cold grey one — *except* on pure-white surface canvases, where warm shadows look muddy and neutral ink shadows are used instead. Default card = white + cream border; product/store cards add a hover **lift** (translateY(-3px) + warm-lg shadow) and the photo zooms (`scale(1.08)`).

**Imagery.** Photography is central and warm — real food, shops, makers; square crops (`object-cover`) on white so they read as catalogue, not stock. Product cards are **photo-dominant** (~3/5 of the card). No illustration system; the only "drawn" assets are the gradient app icon and the wordmark.

**Motion.** Signature easing is `cubic-bezier(0.16, 1, 0.3, 1)` (`--ease-out-quint`). Vocabulary: `fade-in` (150ms), `pop-in` (240ms), `slide-up` for sheets/modals (260ms), `heart-beat` on favourite, a soft pulse for "live/aperto" dots, a slow marquee for the promo ticker, confetti on purchase. Respects `prefers-reduced-motion`.

**States.** Hover → darker shade of the same hue (primary-700→800) or a soft tinted wash for ghost; press → `scale(0.97)` on buttons, `scale(0.95)` on the card "+". Focus → 2px terracotta outline, offset 2px (or a soft terracotta ring on inputs). Error → wine border + wine helper text. Disabled → 50% opacity.

**Layout.** Max width 1280px, 16px gutter. A documented z-index ladder (dropdown 10 → sticky 20 → mobile-nav 30 → modal 50 → toast 60 → tour 70). Modals are bottom-sheets on mobile, centered on desktop. Mobile has a fixed bottom tab bar (72px).

---

## Iconography

- **Lucide** (`lucide-react` in the app) is the **single icon system** — stroke weight **2–2.4**, line style. The codebase deliberately standardised on Lucide and removed all emoji from product UI for brand coherence.
- In these static specimens / kits, Lucide is loaded from CDN (`unpkg.com/lucide`) and rendered via `<i data-lucide="name">` + `lucide.createIcons()`. Signature glyphs: `store`, `bike`, `banknote`, `truck`, `map-pin`, `shopping-cart`, `heart`, `shield-check`, `package`, `sparkles`, `flame`.
- **Order-status icons** are fixed: clock · chef-hat · package · bike · hand · truck · check-circle-2 · x-circle (see `OrderStatusBadge`).
- **No** custom SVG icon set, no icon font, no emoji-as-icon, no unicode glyphs.
- **Logo:** the `My` gradient app icon (`assets/logo-icon.svg`) and the **MyCity** wordmark (`assets/wordmark-light.svg`, `assets/wordmark-ondark.svg`) — Fraunces 800, "My" in mustard, "City" in ink (light) or white (on terracotta).

---

## Index / manifest

**Root**
- `styles.css` — global entry point (consumers link this). `@import`s only.
- `tokens/` — `fonts.css`, `colors.css`, `typography.css`, `spacing.css`, `effects.css`, `base.css`.
- `assets/` — `logo-icon.svg`, `logo-icon-512.svg`, `wordmark-light.svg`, `wordmark-ondark.svg`.
- `guidelines/cards/` — foundation specimen cards (Colors, Type, Spacing, Brand) for the Design System tab.
- `SKILL.md` — Agent-Skill manifest for use in Claude Code.

**Components** (`window.MyCityDesignSystem_*`) — see each `*.prompt.md`:
- `components/core/` — **Button**, **Badge**, **Card**
- `components/forms/` — **Input** (+ `Field`), **Select**, **Checkbox**
- `components/feedback/` — **Modal**, **EmptyState**
- `components/commerce/` — **ProductCard**, **OrderStatusBadge**

**UI kits** — four product surfaces, all interactive click-throughs. Each is a folder with `index.html` + `src/*.js` (source of truth) concatenated into an auto-generated `app.js`. See each kit's `README.md`.
- `ui_kits/buyer/` — **buyer marketplace**: home → search/SRP (faceted filters) → store page → product detail → cart → checkout → order tracking, plus auth and the account hub (orders, favourites, messages, notifications, addresses, profile).
- `ui_kits/seller/` — **seller console**: dashboard (KPIs, health), orders (+ status-advancement drawer), products (+ new-product modal), promotions, analytics, customers, reviews, earnings (+ COD cash).
- `ui_kits/rider/` — **rider app** (phone-framed): deliveries with online toggle, full-screen live-delivery status flow, earnings, availability/zones, profile.
- `ui_kits/pages/` — **static / marketing & legal**: about, how-it-works, FAQ, contact, legal (plain HTML, no React).

> **Architecture note:** kit screen files use the `.js` extension (not `.jsx`) on purpose — the design-system compiler bundles every `.jsx` it finds, which would collide with a kit's own components. Each kit's boot mounts into a dedicated `#mc-app` body-level container so it is immune to any other React root on the page.

### Webfonts — please confirm
Inter and Fraunces are the **real** brand fonts, here loaded from **Google Fonts** (CDN) rather than bundled binaries. If you need fully self-hosted/offline fonts, upload the `.woff2` files and I'll swap `tokens/fonts.css` to `@font-face`.
