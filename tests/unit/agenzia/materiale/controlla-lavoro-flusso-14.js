// COPIA del nodo «Controlla il lavoro» del flusso n8n «14 · Scheda per il venditore» (id 2qD0vp0hWkUjEMNO),
// letta dal flusso vivo il 27/11/2026 alle 17:05 (versione 9c68541d-0005-4358-9058-216220f15ee9).
// Serve alla prova di contratto dell'ordine di SDG (tests/unit/agenzia/l-ordine-di-servizio-arriva-a-sdg.test.ts):
// il lavoro del piano completo deve passare da qui così com'è, senza toccare il flusso. Se il flusso cambia,
// questa copia va riletta dal flusso vivo (sola lettura) e aggiornata.
// 14 · Scheda per il venditore · Controlla il lavoro
// Il sito del venditore (Vercel, cartella venditore/ del repo ad-mycity) manda: { lavoro, venditore, nome, prima, flusso, compito, dati, schema }.
// Il segreto l'ha già controllato «Segreto giusto?». Qui si controlla la forma: un lavoro storto non parte e non si conta.
const b = ($('Dal sito del venditore').first().json || {}).body || {};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const no = (motivo) => [{ json: { valido: false, motivo } }];
if (!UUID.test(String(b.lavoro || ''))) return no('codice del lavoro mancante o storto');
if (typeof b.compito !== 'string' || b.compito.length < 50 || b.compito.length > 30000) return no('compito mancante o troppo lungo');
if (!b.dati || typeof b.dati !== 'object') return no('dati mancanti');
if (!b.schema || typeof b.schema !== 'object') return no('schema mancante');
if (!b.prima || typeof b.prima !== 'object') return no('prima scheda mancante');
const venditore = String(b.venditore || '').trim().toLowerCase();
if (venditore.length > 200 || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(venditore)) return no('venditore mancante');
const prima = JSON.stringify(b.prima);
if (prima.length > 80000) return no('prima scheda troppo grande');
const richiesta = JSON.stringify({ compito: b.compito, dati: b.dati, schema: b.schema });
if (richiesta.length > 60000) return no('lavoro troppo grande per la routine (64 KB)');
return [{ json: {
  valido: true,
  lavoro: String(b.lavoro).toLowerCase(),
  nome: String(b.nome || '').slice(0, 120),
  venditore,
  prima,
  iniziato: Date.now(),
  job: { flusso: '14 · Scheda per il venditore', compito: b.compito, dati: b.dati, schema: b.schema },
} }];
