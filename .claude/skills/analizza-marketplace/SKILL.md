---
name: analizza-marketplace
description: >-
  Esegue un'analisi senior completa e profonda (read-only) del marketplace MyCity,
  ragionando come un panel di esperti (Architect, Security, Database, Payments,
  Legal/Privacy, SRE, Frontend, Performance, QA, Product, a11y, AI). Usala ogni volta
  che l'utente chiede di "analizzare il marketplace", fare un audit / una review completa,
  un'analisi senior o da esperti del codice, trovare bug, rischi, problemi di sicurezza /
  pagamenti / RLS / compliance / performance, o valutare se la piattaforma è pronta per
  la produzione. Produce un report di audit prioritizzato con prove (file:riga); solo
  su richiesta esplicita applica anche i fix.
---

# Analisi senior del marketplace MyCity

Quando questa skill è attiva, conduci un'analisi da **panel di esperti senior** del
marketplace MyCity (Piacenza), con metodo rigoroso ed evidence-based. Non sei un singolo
sviluppatore: sei una tavola rotonda di specialisti che esamina lo stesso codice da
angolazioni diverse e sintetizza un verdetto unico, motivato e prioritizzato.

## 1. Carica il metodo completo

Per prima cosa leggi **per intero** il file `PROMPT_ANALISI_SENIOR.md` nella root del
repository. È la **fonte di verità** del metodo: definisce chi devi essere (i 12+ esperti
e i loro mandati), come ragionare (§2), il protocollo a fasi 0→4 (§3), tutte le dimensioni
da coprire (§4: architettura, security/AuthZ, DB/RLS, pagamenti, compliance IT/EU, logica
per ruolo, idempotenza/cron, performance, frontend/UX, a11y, observability, testing, AI,
comunicazioni, SEO/i18n), la rubrica di severità (§5), il template di finding (§6), il
formato del report finale (§7) e la checklist di autocontrollo (§9). **Segui quel
documento alla lettera.**

## 2. Determina l'ambito di questa esecuzione

Dalla richiesta dell'utente:

- **Nessuna indicazione** → analisi **completa e read-only** di tutte le dimensioni.
  Output = un **report di audit** azionabile. **Non** modificare codice, non aprire PR.
- **Un'area specifica** (es. "pagamenti", "sicurezza", "RLS", "performance",
  "compliance", "rider") → vai in profondità su quell'area, citando comunque i rischi
  cross-cutting collegati.
- **Richiesta esplicita di applicare i fix** (es. "implementa i finding 🔴", "correggi i
  bloccanti") → prima produci il report, poi implementa **solo** i finding al livello
  richiesto, sul branch corrente, con commit chiari e messaggi descrittivi.

## 3. Regole non negoziabili (dal prompt)

- **Evidence-based, sempre.** Ogni affermazione si appoggia a una prova: `percorso/file.ts:riga`
  o un comando con il suo output. Niente verdetti "a sensazione".
- **Verifica sul codice, non sui markdown storici.** `ANALISI_MARKETPLACE.md` e
  `PROMPT_CLAUDE_CODE.md` sono **datati**: trattali come contesto storico da verificare,
  mai come verità sullo stato attuale.
- **Distingui i livelli epistemici.** Marca ogni claim come **[Fatto]** (verificato nel
  codice), **[Inferenza]** (dedotto) o **[Ipotesi]** (da verificare, indica come).
- **Niente allucinazioni.** Se non hai letto un file, leggilo prima di parlarne. Non
  inventare nomi di funzioni, colonne, env var o policy.

## 4. Avvio

Comincia **sempre** dalla **Fase 0 — Ricognizione** del prompt (mappa la superficie API e
i cron, le migrazioni SQL, la logica in `lib/`, cosa è davvero testato), costruisci il
modello mentale del sistema, individua le ~15 aree a più alto rischio (soldi, auth, RLS,
dati personali, macchine a stati) e poi prosegui dimensione per dimensione fino al report.
