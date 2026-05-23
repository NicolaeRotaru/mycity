import Link from 'next/link';

export const metadata = {
  title: 'Privacy policy · MyCity',
  description: 'Informativa sulla privacy del marketplace MyCity ai sensi del GDPR.',
};

export default function PrivacyPage() {
  return (
    <div className="container mx-auto px-6 py-10 max-w-3xl">
      <div className="mb-8">
        <Link href="/" className="text-sm text-indigo-600 hover:underline">← Home</Link>
        <h1 className="text-3xl md:text-4xl font-extrabold text-gray-900 mt-2 mb-2">Privacy policy</h1>
        <p className="text-sm text-gray-500">Ultimo aggiornamento: 1° gennaio 2026</p>
      </div>

      <div className="prose prose-gray max-w-none space-y-6 text-gray-700 leading-relaxed">
        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">1. Titolare del trattamento</h2>
          <p><strong>MyCity S.r.l.</strong>, Via Roma 1, 29121 Piacenza (PC), Italia.<br />
          Email: <a href="mailto:privacy@mycity.it" className="text-indigo-600 underline">privacy@mycity.it</a> · PEC: mycity@pec.it</p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">2. Dati che trattiamo</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Dati di registrazione:</strong> nome, cognome, email, telefono.</li>
            <li><strong>Dati di consegna:</strong> indirizzi (via, città, CAP, coordinate geografiche).</li>
            <li><strong>Dati degli ordini:</strong> prodotti acquistati, prezzi, venditori, recensioni.</li>
            <li><strong>Dati di pagamento:</strong> non memorizziamo PAN o CVV; il pagamento attuale è alla consegna.</li>
            <li><strong>Dati tecnici:</strong> indirizzo IP, user-agent, cookie tecnici e analitici.</li>
            <li><strong>Dati di geolocalizzazione:</strong> solo previo consenso, per mostrare negozi vicini.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">3. Finalità e basi giuridiche</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Esecuzione del contratto</strong> (art. 6.1.b GDPR): creazione account, gestione ordini e consegne.</li>
            <li><strong>Obblighi di legge</strong> (art. 6.1.c GDPR): fatturazione, conservazione documenti fiscali.</li>
            <li><strong>Legittimo interesse</strong> (art. 6.1.f GDPR): sicurezza piattaforma, prevenzione frodi.</li>
            <li><strong>Consenso</strong> (art. 6.1.a GDPR): newsletter, marketing, cookie non tecnici, geolocalizzazione.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">4. Conservazione</h2>
          <p>Conserviamo i dati per il tempo necessario alle finalità: dati account fino alla cancellazione; dati fiscali
          per 10 anni come da legge; dati marketing fino a revoca del consenso.</p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">5. Destinatari</h2>
          <p>I dati possono essere comunicati a:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Venditori e rider, limitatamente ai dati necessari per evadere l'ordine.</li>
            <li>Fornitori IT (hosting, database, email transazionali, mappe), come responsabili del trattamento.</li>
            <li>Autorità competenti su richiesta legale.</li>
          </ul>
          <p>I dati restano nell'UE. Eventuali trasferimenti extra-UE avvengono con garanzie adeguate (clausole standard).</p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">6. I tuoi diritti</h2>
          <p>Hai diritto di: accesso, rettifica, cancellazione, limitazione, portabilità, opposizione, revoca del consenso.
          Puoi esercitarli da <Link href="/profile/settings" className="text-indigo-600 underline">Impostazioni account</Link> o scrivendo a
          <a href="mailto:privacy@mycity.it" className="text-indigo-600 underline ml-1">privacy@mycity.it</a>.</p>
          <p>Hai diritto di reclamo all'<a href="https://www.garanteprivacy.it" target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline">Autorità Garante per la Protezione dei Dati Personali</a>.</p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">7. Sicurezza</h2>
          <p>Applichiamo misure tecniche e organizzative adeguate: cifratura in transito (TLS), hash delle password,
          backup, controlli d'accesso, monitoraggio degli accessi.</p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">8. Cookie</h2>
          <p>Per dettagli sui cookie consulta la <Link href="/cookies" className="text-indigo-600 underline">Cookie Policy</Link>.</p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">9. Modifiche</h2>
          <p>Possiamo aggiornare questa policy. La versione vigente è sempre disponibile a questo indirizzo con la data
          di ultimo aggiornamento.</p>
        </section>
      </div>

      <div className="mt-10 p-4 bg-gray-50 rounded-lg text-xs text-gray-500">
        Questa informativa è un modello generico. Per il lancio in produzione fai validare il testo a un DPO o
        consulente privacy.
      </div>
    </div>
  );
}
