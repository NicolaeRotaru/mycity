# Dove vive il sito, e cosa cambia perché vive lì

> `vercel.json` non accetta commenti: questo file è la sua spiegazione.
> Aggiornalo insieme a quello, non dopo.

Il marketplace gira su **Vercel**, progetto `mycity`, collegato al repository
`NicolaeRotaru/mycity`. Prima stava su Render. Non è un cambio di indirizzo: è
un cambio di forma. Su Render c'era **una macchina accesa**, sempre la stessa,
con la sua memoria e il suo orologio. Su Vercel non esiste una macchina: esiste
una funzione che qualcuno accende quando arriva una richiesta e spegne appena ha
finito. Tutto quello che sotto è scritto discende da questa frase.

---

## 1. La regione: Parigi, non Washington

```json
"regions": ["cdg1"]
```

Il database (Supabase, progetto `Mycity`) sta a **Parigi**, regione `eu-west-3`.
Vercel, se non gli si dice niente, esegue le funzioni a **Washington** (`iad1`).

Il 22/8/2026 la produzione rispondeva con l'intestazione
`x-vercel-id: iad1:iad1::iad1::…`: ogni pagina del sito attraversava l'Atlantico
per fare le sue domande al database, e riattraversava per la risposta. Non una
volta a pagina: **una volta per query**, e una pagina di catalogo ne fa parecchie.

`cdg1` è Parigi, cioè la stessa città del database. È il modo più economico che
esiste di rendere un sito più veloce: una riga di configurazione.

Il freno: `tests/unit/lavori-periodici-agganciati-a-vercel.test.ts` diventa rosso
se qualcuno toglie la regione.

---

## 2. I lavori periodici: li fa partire Vercel

```json
"crons": [ { "path": "/api/cron/send-push", "schedule": "*/5 * * * *" }, … ]
```

Prima li faceva partire **cron-job.org**, un servizio esterno gratuito, perché su
Render il cron era un prodotto a parte da pagare. Su Vercel sono inclusi nel
piano, quindi il pezzo esterno non serve più.

Tre cose da sapere, tutte imparate rompendole:

1. **Vercel bussa solo in GET.** Cinque rotte su nove esportavano solo `POST`:
   sarebbero partite e avrebbero risposto «405 metodo non ammesso» a ogni giro —
   il lavoro risulta eseguito, e non ha fatto niente. Ora ogni rotta esporta
   entrambi. Il `POST` resta valido apposta: finché i lavori su cron-job.org sono
   accesi, i due mondi convivono senza rompere nulla.

2. **Il segreto lo manda Vercel da solo**, come
   `Authorization: Bearer <CRON_SECRET>`, prendendolo dalla variabile del
   progetto che si chiama **esattamente** `CRON_SECRET`. Se quella variabile non
   c'è, i lavori partono e si prendono un 401: silenziosi, perché il giro
   «è andato».

3. **Vanno spenti su cron-job.org**, altrimenti tutto gira due volte. Non fa
   danni — i lavori sono idempotenti e prendono i loro record con un claim
   atomico — ma è lavoro e denaro buttati, e i log diventano illeggibili.

L'elenco a parole, con cosa fa ognuno, sta in `docs/crons.json`. La verità su
cosa gira davvero è `vercel.json`, e una prova controlla che i due combacino.

---

## 3. Quanto può durare una funzione

```json
"functions": { "app/api/cron/**/route.ts": { "maxDuration": 300 }, … }
```

Su Render un processo che ci metteva tre minuti ci metteva tre minuti. Su Vercel
c'è un tetto, e oltre il tetto la funzione viene **troncata a metà**: nessun
errore applicativo, nessuna eccezione da mandare a Sentry — la richiesta muore e
basta. I giri che possono essere lunghi sono quelli che svuotano una coda dopo un
guasto (email, push) e quelli che pagano i negozi dopo un weekend.

I tetti dichiarati qui valgono per il piano **Pro**, che è quello attivo.

---

## 4. Il freno anti-abuso non è più gratis

Su Render, «dieci tentativi di accesso al minuto» erano dieci: un processo solo,
un contatore solo. Su Vercel ogni richiesta può finire su una copia diversa, e
ogni copia parte con i contatori a zero: diventano dieci **per copia**, e quante
copie ci sono lo decide il traffico.

Il codice ripiega sempre sul contatore in memoria (mai lasciare il sito senza
freno), ma il numero scritto nel codice smette di dire la verità. Per farlo
tornare a dirla servono `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN`
fra le variabili del progetto — vedi `lib/rate-limit.ts`.

Perché la cosa si veda invece di restare un'opinione: `/api/health` risponde
**«degradato»** finché quelle due mancano.

---

## 5. L'indirizzo del sito

`NEXT_PUBLIC_APP_URL` decide il dominio con cui il sito si presenta: il
`canonical` che legge Google, l'`og:url` delle anteprime condivise, i link nelle
email, il ritorno da Stripe dopo il pagamento.

Il 22/8/2026 non era fra le variabili su Vercel, e il ripiego nel codice puntava
a `http://localhost:3000`. Il sito serviva, a chiunque e a Google:

```html
<link rel="canonical" href="http://localhost:3000">
<meta property="og:url" content="http://localhost:3000">
```

Nessun errore nei log. Rispondeva 200 e sembrava a posto.

Adesso, se manca, `lib/env.ts` ripiega sul dominio che Vercel dichiara da solo —
quello di produzione, o quello dell'anteprima se siamo in un'anteprima. È un
paracadute: `/api/health` continua a rispondere **503** finché la variabile non
c'è, perché il dominio giusto lo sa solo chi lo ha comprato.

---

## 6. La versione di Node

Una sola, in tre posti che devono dire lo stesso numero: `24`.

| Dove | Cosa |
|---|---|
| `package.json` → `engines.node` | `24.x` — **vince su tutto il resto**, anche sull'impostazione del progetto Vercel |
| `.nvmrc` | `24` — chi sviluppa in locale |
| `.github/workflows/*` | `24` — la CI e il passo che costruisce prima di pubblicare |

Prima il rilascio costruiva su Node 20 e la produzione eseguiva su 24.

---

## 7. Rilascio e ritorno indietro

- **Rilascio:** ogni unione su `main` fa partire una pubblicazione di produzione.
  Il gancio che aspetta la CI verde è in `.github/workflows/deploy-dopo-ci.yml`,
  e non è ancora l'unica strada: legge il file per i due passi che mancano.
- **Tornare indietro:** Vercel → Deployments → **Instant Rollback**. Procedura
  distesa nel runbook, §4-bis.

---

## 8. Quello che manca ancora, e non lo può fare il codice

Sono cose che vivono nel pannello di Vercel o dal gestore del dominio, non in
questo repository. Stanno in `AZIONI-IN-ATTESA` nella repo dell'AD.

- Le **variabili d'ambiente** del progetto. Al 22/8/2026 mancavano almeno
  `SUPABASE_SERVICE_ROLE_KEY` (70 errori veri nei log di produzione, su
  `/api/track` e `/api/consent`) e `NEXT_PUBLIC_APP_URL`. Senza la prima il sito
  **non può registrare un ordine**: il webhook di Stripe non scrive.
- Il **dominio**. `mycity-marketplace.com` risolve ancora su `216.24.57.1`, che è
  l'indirizzo di Render. Finché resta lì, il sito su Vercel è raggiungibile solo
  a `mycity-phi.vercel.app`.
