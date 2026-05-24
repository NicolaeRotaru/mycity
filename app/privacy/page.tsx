import Link from 'next/link';

export const metadata = {
  title: 'Informativa sulla privacy · MyCity',
  description: 'Come trattiamo i tuoi dati personali ai sensi del Regolamento UE 2016/679 (GDPR).',
};

const VERSION = '2.0';
const EFFECTIVE_DATE = '24 maggio 2026';

export default function PrivacyPage() {
  return (
    <div className="container mx-auto px-6 py-10 max-w-3xl">
      <div className="mb-8">
        <Link href="/" className="text-sm text-indigo-600 hover:underline">← Home</Link>
        <h1 className="text-3xl md:text-4xl font-extrabold text-gray-900 mt-2 mb-2">Informativa sulla privacy</h1>
        <p className="text-sm text-gray-500">Versione {VERSION} — in vigore dal {EFFECTIVE_DATE}</p>
        <p className="text-sm text-gray-500">Ai sensi degli artt. 13-14 Reg. UE 2016/679 (GDPR)</p>
      </div>

      <div className="prose prose-gray max-w-none space-y-6 text-gray-700 leading-relaxed">
        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">1. Titolare del trattamento</h2>
          <p>
            Il titolare del trattamento è <strong>MyCity S.r.l.</strong>, con sede in
            Via Roma 1, 29121 Piacenza (PC), P.IVA IT00000000000.
          </p>
          <p>
            <strong>Contatti del Titolare:</strong> <a href="mailto:privacy@mycity.it" className="text-indigo-600 underline">privacy@mycity.it</a><br />
            <strong>Responsabile della protezione dei dati (DPO):</strong> <a href="mailto:dpo@mycity.it" className="text-indigo-600 underline">dpo@mycity.it</a>
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">2. Categorie di dati trattati</h2>
          <ul className="list-disc list-inside space-y-1">
            <li><strong>Dati anagrafici e di contatto:</strong> nome, cognome, email, telefono, indirizzo di consegna e di residenza.</li>
            <li><strong>Dati di account:</strong> credenziali (password hashata), data di registrazione, preferenze, log di accesso, indirizzo IP, user-agent.</li>
            <li><strong>Dati fiscali (Venditori):</strong> codice fiscale, partita IVA, ragione sociale, sede legale, PEC, codice SDI, IBAN.</li>
            <li><strong>Documenti d&apos;identità (KYC per Venditori/Rider):</strong> documento di riconoscimento, patente, certificato HACCP, polizza RC — trattati e conservati con misure di sicurezza rafforzate.</li>
            <li><strong>Dati di transazione:</strong> ordini, importi, metodi di pagamento, ultime 4 cifre della carta (mai il numero completo né il CVV).</li>
            <li><strong>Dati di geolocalizzazione:</strong> posizione del Rider durante la consegna; indirizzo di consegna; posizione approssimativa dell&apos;Acquirente per la funzione &quot;Vicino a te&quot; (solo previo consenso esplicito).</li>
            <li><strong>Contenuti generati dall&apos;utente:</strong> recensioni, foto, messaggi nelle chat ordine.</li>
            <li><strong>Dati di navigazione:</strong> pagine visitate, click, tempo di permanenza (se attivi i cookie analytics).</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">3. Finalità, basi giuridiche e periodi di conservazione</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full border border-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="border px-3 py-2 text-left">Finalità</th>
                  <th className="border px-3 py-2 text-left">Base giuridica</th>
                  <th className="border px-3 py-2 text-left">Conservazione</th>
                </tr>
              </thead>
              <tbody>
                <tr><td className="border px-3 py-2">Creazione e gestione account</td><td className="border px-3 py-2">Esecuzione contratto (art. 6.1.b GDPR)</td><td className="border px-3 py-2">Fino a cancellazione account</td></tr>
                <tr><td className="border px-3 py-2">Esecuzione ordini e consegne</td><td className="border px-3 py-2">Esecuzione contratto</td><td className="border px-3 py-2">10 anni (obblighi fiscali)</td></tr>
                <tr><td className="border px-3 py-2">Fatturazione e contabilità</td><td className="border px-3 py-2">Obbligo di legge (art. 6.1.c)</td><td className="border px-3 py-2">10 anni (art. 2220 c.c.)</td></tr>
                <tr><td className="border px-3 py-2">Verifica KYC e antiriciclaggio</td><td className="border px-3 py-2">Obbligo di legge</td><td className="border px-3 py-2">10 anni dalla cessazione rapporto</td></tr>
                <tr><td className="border px-3 py-2">Sicurezza, anti-frode</td><td className="border px-3 py-2">Legittimo interesse (art. 6.1.f)</td><td className="border px-3 py-2">12 mesi (log accessi)</td></tr>
                <tr><td className="border px-3 py-2">Newsletter e marketing</td><td className="border px-3 py-2">Consenso (art. 6.1.a)</td><td className="border px-3 py-2">Fino a revoca consenso</td></tr>
                <tr><td className="border px-3 py-2">Analytics aggregati</td><td className="border px-3 py-2">Consenso (cookie)</td><td className="border px-3 py-2">14 mesi</td></tr>
                <tr><td className="border px-3 py-2">Gestione reclami e contenzioso</td><td className="border px-3 py-2">Legittimo interesse</td><td className="border px-3 py-2">Fino a prescrizione (10 anni)</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">4. Destinatari dei dati (sub-responsabili)</h2>
          <p>
            I tuoi dati sono trattati da fornitori esterni che operano come Responsabili del
            trattamento ex art. 28 GDPR, vincolati da accordo DPA:
          </p>
          <ul className="list-disc list-inside space-y-1">
            <li><strong>Supabase Inc.</strong> (Stati Uniti — Standard Contractual Clauses) — hosting database, autenticazione, storage.</li>
            <li><strong>Stripe Payments Europe Ltd.</strong> (Irlanda) — gestione pagamenti elettronici, PSP autorizzato.</li>
            <li><strong>Resend Inc.</strong> (Stati Uniti — SCC) — invio email transazionali.</li>
            <li><strong>Cloudflare Inc.</strong> (Stati Uniti — SCC) — CDN, protezione DDoS, CAPTCHA.</li>
            <li><strong>Anthropic PBC</strong> (Stati Uniti — SCC) — analisi immagini prodotto via AI (solo immagini caricate dai venditori; nessun dato personale dell&apos;acquirente).</li>
            <li><strong>Provider SDI</strong> (FattureInCloud / Aruba) — fatturazione elettronica e conservazione sostitutiva a norma.</li>
            <li><strong>Provider KYC</strong> (Onfido / Jumio / Veriff) — verifica documenti d&apos;identità per Venditori e Rider.</li>
            <li><strong>OpenStreetMap Foundation</strong> (Regno Unito) — geocoding indirizzi.</li>
          </ul>
          <p>
            <strong>Trasferimenti extra-UE:</strong> sono protetti da Standard Contractual Clauses
            adottate dalla Commissione Europea (Decisione 2021/914).
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">5. Diritti dell&apos;interessato (artt. 15-22 GDPR)</h2>
          <p>Hai diritto di:</p>
          <ul className="list-disc list-inside space-y-1">
            <li><strong>Accedere</strong> ai tuoi dati e ricevere una copia (art. 15);</li>
            <li><strong>Rettificare</strong> dati inesatti o incompleti (art. 16);</li>
            <li><strong>Cancellare</strong> i dati (&quot;diritto all&apos;oblio&quot;) nei casi previsti (art. 17);</li>
            <li><strong>Limitare</strong> il trattamento (art. 18);</li>
            <li><strong>Ricevere</strong> i dati in formato strutturato e leggibile (portabilità, art. 20);</li>
            <li><strong>Opporsi</strong> al trattamento basato sul legittimo interesse o per marketing (art. 21);</li>
            <li><strong>Non essere</strong> sottoposto a decisioni automatizzate con effetti significativi (art. 22).</li>
          </ul>
          <p>
            Puoi esercitare questi diritti dalla pagina{' '}
            <Link href="/profile/settings" className="text-indigo-600 underline">Impostazioni → Privacy</Link>{' '}
            (dove trovi i pulsanti &quot;Scarica i miei dati&quot; e &quot;Cancella account&quot;) oppure
            scrivendo a{' '}
            <a href="mailto:dpo@mycity.it" className="text-indigo-600 underline">dpo@mycity.it</a>.
          </p>
          <p>
            Hai diritto di presentare reclamo al{' '}
            <a href="https://www.garanteprivacy.it/" target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline">
              Garante per la protezione dei dati personali
            </a>{' '}
            (Piazza Venezia 11, 00187 Roma).
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">6. Misure di sicurezza</h2>
          <p>
            Adottiamo misure tecniche e organizzative idonee a proteggere i dati: trasmissione
            crittografata (TLS 1.3), password hashate con bcrypt, accesso ai dati su base
            need-to-know, log di accesso, Row Level Security a livello database, backup giornalieri
            cifrati, formazione del personale, security headers (HSTS, CSP, X-Frame-Options).
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">7. Data breach</h2>
          <p>
            In caso di violazione di dati personali che comporti un rischio elevato per i tuoi
            diritti, ti informeremo senza ingiustificato ritardo e notificheremo l&apos;evento al
            Garante entro 72 ore, ai sensi dell&apos;art. 33 GDPR.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">8. Cookie</h2>
          <p>
            Per i dettagli sui cookie usati e su come gestire le preferenze, consulta la nostra{' '}
            <Link href="/cookies" className="text-indigo-600 underline">Cookie policy</Link>.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">9. Modifiche all&apos;informativa</h2>
          <p>
            Possiamo aggiornare questa informativa per riflettere modifiche normative o operative.
            Le versioni precedenti restano consultabili su richiesta scrivendo a{' '}
            <a href="mailto:dpo@mycity.it" className="text-indigo-600 underline">dpo@mycity.it</a>.
          </p>
        </section>
      </div>

      <div className="mt-10 p-4 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">
        <strong>Avviso legale:</strong> questo documento è ispirato al GDPR e alle linee guida del
        Garante italiano. Va validato da un DPO/avvocato prima dell&apos;uso in produzione,
        verificando che i sub-responsabili effettivamente integrati corrispondano a quelli elencati.
      </div>
    </div>
  );
}
