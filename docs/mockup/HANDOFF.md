# HANDOFF — MyCity Design System → repo `mycity`

Questo pacchetto è un **design system di riferimento** per MyCity Piacenza. NON è codice di
produzione: contiene token CSS, componenti React semplificati (React+Babel da CDN) e 4 UI kit
interattivi. Serve come **fonte di verità visiva** da cui ricostruire/allineare lo stack reale
(Next.js + TypeScript + Tailwind).

## Cosa contiene
- `styles.css` + `tokens/` — colori, tipografia, spaziatura, ombre, motion (167 token).
- `components/` — 11 primitive (Button, Badge, Card, Input, Select, Checkbox, Modal, EmptyState,
  ProductCard, OrderStatusBadge) con `.d.ts` e `.prompt.md`.
- `ui_kits/buyer|seller|rider|pages/` — ricostruzioni interattive delle 4 superfici.
- `guidelines/cards/` — specimen visivi dei token.
- `readme.md` — la guida completa (leggila per prima).

## Compito per Claude Code
1. Leggi `readme.md` e `SKILL.md`, poi `tokens/*.css` e `components/*/*.prompt.md`.
2. Porta **token e foundation** nel nostro stack: mappa i valori su `tailwind.config.ts` e
   `app/globals.css` (vedi mappatura sotto).
3. Dove migliorano i componenti esistenti, allinea stili/varianti in `components/ui/`.
4. **NON** importare i file `.js`/Babel dei kit così come sono: sono riferimento visivo, non codice.
5. Lavora su un branch nuovo (`design-system-tokens`) e apri una PR con un riassunto.

## Mappatura token → Tailwind (theme.extend.colors)
```
primary:   { 50:#FDF4F1, 100:#FAE3DC, 200:#F5C5B6, 300:#EE9F86, 400:#E47A5A,
             500:#D55F3F, 600:#C0492C, 700:#A03B25, 800:#7F2F1F, 900:#5C211A }  // terracotta
accent:    { 100:#FDECC8, 300:#F4BC53, 500:#E8A33D, 700:#9D621C }               // mostarda
olive:     { 50:#F6F8F1, 100:#E9EEDE, 500:#7C8B5A, 600:#5A7C42, 700:#456236 }   // success
secondary: { 100:#FCE0E0, 500:#D63E3B, 600:#B82A28 }                            // vino
cream:     { 50:#FEFCF8, 100:#FBF7F0, 200:#F5EDD9, 300:#EEDFBA, 400:#E6CC95 }   // sfondo
ink:       { 500:#57534E, 600:#44403C, 800:#2C2A28, 900:#1C1A18 }               // testo
```
- Font: `font-serif` = **Fraunces** (display/titoli), `font-sans` = **Inter** (UI/body).
- Radius: card 12–20px, bottoni 8px, pill 9999px.
- Ombre calde su crema (rgba terracotta), neutre su bianco.
- Icone: **Lucide** (`lucide-react`), stroke 2–2.4. Niente emoji nelle UI.

## Tono di copy
Italiano, "tu", caldo e rassicurante. Punto forte sempre in evidenza: **paghi alla consegna**.
