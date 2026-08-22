# UI Kit — MyCity Seller (console venditore)

High-fidelity recreation of the **seller console**. Dark sidebar shell + topbar; built from the design-system components.

## Run
Open `index.html`. Loads React 18, Babel, Lucide, `_ds_bundle.js`, then `src/data.js` + `app.js`.

## Screens (sidebar nav)
- **Dashboard** — gradient hero (revenue Oggi/7gg/30gg), KPI cards, nav hub, health-score ring, growth tips.
- **Ordini** — grouped Da fare / In consegna / Completati; click a row → detail drawer with **status advancement** (Accetta → Pronto → Assegna al rider) and COD cash note.
- **Prodotti** — catalogue table (price/discount, stock, sold, status) with tabs + **new-product modal**.
- **Promozioni** — active/ended promos with toggle.
- **Analisi** — 7-day revenue bars + top products.
- **Clienti** — customer table (orders, spent, last).
- **Recensioni** — rating breakdown + reviews with reply.
- **Guadagni** — period switcher, gross/commission/net stats, **COD cash** card, payout history.

## Architecture (same as all MyCity kits)
- `src/*.js` are the **source of truth**, concatenated in numeric order into `app.js` (auto-generated) and loaded as one `text/babel` script.
- Files are **`.js` not `.jsx`** on purpose: the design-system compiler bundles every `.jsx`, which would collide with the kit. The boot mounts into a dedicated `#mc-app` body container, immune to other React roots on the page.
- Styling = inline + design-system CSS custom properties. Images = LoremFlickr (keyword + locked seed).

## Out of scope
Stripe Connect onboarding, CSV import internals, stories editor — represented as buttons/placeholders.
