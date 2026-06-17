# UI Kit — MyCity Rider (app rider)

High-fidelity recreation of the **rider app**, mobile-first: framed in a phone bezel with a bottom tab bar.

## Run
Open `index.html`. Loads React 18, Babel, Lucide, `_ds_bundle.js`, then `src/data.js` + `app.js`.

## Screens (bottom tabs + flow)
- **Consegne (home)** — rider header (rating), **online/offline toggle**, today mini-stats, your active delivery card, available orders (Accetta), in-preparation list.
- **Live delivery** (full-screen over the phone) — route map placeholder, **status flow** ASSIGNED → PICKED_UP → OUT_FOR_DELIVERY → DELIVERED with one big action button, store/customer target card (Naviga/Chiama), order summary + **COD cash to collect**, completion screen.
- **Guadagni** — period switcher, big earned number + KPIs, 7-day bars, IBAN/payout note, delivery history.
- **Turni & zone** — online toggle, preferred-zone selection, peak-hours tip.
- **Profilo** — rider header, vehicle/zone tiles, settings list.

## Architecture
Same as all MyCity kits: `src/*.js` (source of truth) concatenated into the auto-generated `app.js`, loaded as one `text/babel` script. `.js` not `.jsx` so the DS compiler doesn't bundle it; boot mounts into `#mc-app` (body-level, immune to other roots). Inline styles + design-system tokens; LoremFlickr images.

## Notes
Phone frame is 390×844. The map is a stylised placeholder (no real map SDK). Onboarding/help/reviews exist in the product; the core daily-driver loop is covered here.
