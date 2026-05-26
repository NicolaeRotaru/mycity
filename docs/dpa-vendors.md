# DPA Vendors — Data Processing Agreements

> Lista DPA da firmare per compliance GDPR. Aggiornare quando si aggiunge un nuovo vendor che processa dati personali.

---

## Vendor che PROCESSANO dati personali

| Vendor | Dati processati | DPA URL | Firmato? | Data |
|---|---|---|---|---|
| **Supabase** | Email, password (hash), profile data, orders, messages | https://supabase.com/dpa | ❌ | TBD |
| **Stripe** | Email, address, payment info, transaction history | https://stripe.com/legal/dpa | ❌ | TBD |
| **Resend** | Email destinatari, subject, body, open/click tracking | https://resend.com/legal/dpa | ❌ | TBD |
| **Anthropic** | Prompt content (description product input) | https://www.anthropic.com/legal/dpa | ❌ | TBD |
| **PostHog** | Events, session replay (mascherato PII), user ID | https://posthog.com/dpa | ❌ | TBD (EU instance riduce esposizione) |
| **Sentry** | Error stacks, breadcrumbs, user ID | https://sentry.io/legal/dpa/ | ❌ | TBD |
| **Cloudflare** (Turnstile) | IP address, browser fingerprint | https://www.cloudflare.com/cloudflare-customer-dpa/ | ❌ | TBD |
| **Render** | Server logs (può contenere IP/UA) | https://render.com/legal/dpa | ❌ | TBD |
| **Google Analytics** (GA4) | IP anonymized, events, user ID | https://business.safety.google/adsprocessorterms/ | ❌ | TBD (Consent Mode v2 attivo) |

## Vendor che NON processano dati personali (no DPA)

- **Netsons** (DNS): nessun personal data
- **OpenStreetMap** (tile server): tile request anonime
- **Lucide** (icons): static asset
- **Vercel** (font loading via next/font): cached, no PII

---

## Azioni richieste (per il founder)

1. **Per ogni vendor sopra**:
   - Andare al link DPA
   - Firmare elettronicamente (account vendor dashboard, di solito)
   - Aggiornare la colonna "Firmato?" e "Data"
2. **Conservare copie PDF** delle DPA firmate in cloud storage privato (es. Google Drive `MyCity/legal/`)
3. **Audit trimestrale**: aggiungere nuovo vendor → DPA firmato prima di go-live

## Privacy Policy menziona i vendor?

Verifica che `app/privacy/page.tsx` elenca tutti i vendor sopra con:
- Nome del vendor
- Categoria dati condivisi
- Finalità del trattamento
- Link alla loro privacy policy

## Subprocessor list

GDPR Art. 28 richiede che la lista subprocessor sia accessibile pubblicamente. Pubblicarla su:

```
/legal/subprocessors
```

(TODO: creare pagina pubblica con questa lista)

---

## Notifica utenti su cambio subprocessor

GDPR Art. 28(2): notifica preventiva agli utenti se aggiungi nuovo subprocessor.

Procedura:
1. Aggiunto vendor → email a tutti gli utenti loyalty/registered
2. Periodo di opt-out di 30 giorni
3. Aggiornare lista pubblica

---

*Doc maintenance: revisione ogni 6 mesi. Aggiungere reminder calendario.*
