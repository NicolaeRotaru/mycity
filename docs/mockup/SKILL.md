---
name: mycity-design
description: Use this skill to generate well-branded interfaces and assets for MyCity Piacenza (the "Mediterranean Modern" local-shops marketplace), either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the `readme.md` file within this skill, and explore the other available files (`styles.css` + `tokens/`, the `components/` with their `*.prompt.md`, the foundation cards in `guidelines/cards/`, and `ui_kits/marketplace/`).

MyCity is an Italian local-marketplace for Piacenza: warm terracotta/cream/mustard/olive palette, Fraunces (serif display) + Inter (UI), Lucide icons, "paghi alla consegna" tone. Brand copy is in Italian, informal "tu", reassuring and local. No emoji in product UI.

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out (logos in `assets/`, the token CSS) and create static HTML files for the user to view — link `styles.css` and use the CSS custom properties; load Lucide from CDN for icons. Four full product surfaces are recreated under `ui_kits/`: **buyer** (marketplace), **seller** (console), **rider** (app), and **pages** (static/legal) — open any `index.html` to explore the real flows. If working on production code, copy assets and read the rules here to become an expert in designing with this brand; the real components live in the `NicolaeRotaru/mycity` repo (`components/ui/*`).

If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.
