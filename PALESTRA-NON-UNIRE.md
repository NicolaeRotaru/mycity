# Questo ramo è della palestra: non si unisce mai

La palestra è una copia del sito fatta solo per le prove, firmata da Nicola il 7/11/2026 (carta 232).
Gira come anteprima di un progetto Vercel separato, su un ramo di prova del database con dati finti.

L'unica differenza da `main` è l'interruttore della carta in `lib/funzioni-al-lancio.ts`: qui si
accende solo se l'anteprima ha `NEXT_PUBLIC_PALESTRA_CARTA_ACCESA=1`, con le chiavi Stripe di test.
Su `main` la carta resta spenta finché Nicola non la accende.

Quando le prove sono finite il ramo si cancella insieme al database di prova.

## Com'è fatta

- Progetto Vercel `mycity-palestra`, separato da quello del sito. Costruisce solo questo ramo, come anteprima
  (regola «Ignored Build Step»); le sue variabili valgono solo per le anteprime.
- Database: il ramo di prova `palestra` di Supabase, con le migrazioni di questo deposito e dati finti
  (negozi, clienti e fattorini con email `@*.local`, che non ricevono posta).
- Intelligenza artificiale finta, Turnstile e Stripe di prova, nessuna email vera (senza `RESEND_API_KEY`).
