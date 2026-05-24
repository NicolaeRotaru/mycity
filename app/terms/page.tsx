import Link from 'next/link';

export const metadata = {
  title: 'Termini di servizio · MyCity',
  description: 'Termini e condizioni d\'uso del marketplace MyCity.',
};

const VERSION = '2.0';
const EFFECTIVE_DATE = '24 maggio 2026';

export default function TermsPage() {
  return (
    <div className="container mx-auto px-6 py-10 max-w-3xl">
      <div className="mb-8">
        <Link href="/" className="text-sm text-indigo-600 hover:underline">← Home</Link>
        <h1 className="text-3xl md:text-4xl font-extrabold text-gray-900 mt-2 mb-2">Termini di servizio</h1>
        <p className="text-sm text-gray-500">Versione {VERSION} — in vigore dal {EFFECTIVE_DATE}</p>
      </div>

      <div className="prose prose-gray max-w-none space-y-6 text-gray-700 leading-relaxed">
        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">1. Premesse e definizioni</h2>
          <p>
            I presenti Termini di Servizio (&quot;<strong>Termini</strong>&quot;) regolano l&apos;utilizzo
            della piattaforma MyCity (il &quot;<strong>Servizio</strong>&quot;), gestita da
            <strong> MyCity S.r.l.</strong>, con sede in Via Roma 1, 29121 Piacenza (PC), Italia,
            P.IVA IT00000000000, REA PC-000000, PEC mycity@pec.it (di seguito &quot;MyCity&quot;, &quot;noi&quot;).
          </p>
          <p>
            <strong>Definizioni:</strong> &quot;<strong>Acquirente</strong>&quot; o &quot;<strong>Utente</strong>&quot;
            è la persona fisica o giuridica che acquista tramite il Servizio;
            &quot;<strong>Venditore</strong>&quot; è il professionista titolare di partita IVA che
            offre i propri prodotti tramite il Servizio; &quot;<strong>Rider</strong>&quot; è il
            soggetto, autonomo o parasubordinato, che esegue le consegne;
            &quot;<strong>Contenuti</strong>&quot; sono tutti i dati pubblicati sulla piattaforma.
          </p>
          <p>
            Accedendo o utilizzando il Servizio dichiari di aver letto, compreso e accettato i
            presenti Termini, l&apos;<Link href="/privacy" className="text-indigo-600 underline">Informativa
            sulla privacy</Link> e la <Link href="/cookies" className="text-indigo-600 underline">Cookie
            policy</Link>.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">2. Natura del Servizio (P2B Regulation)</h2>
          <p>
            MyCity è un servizio di intermediazione online ai sensi del Regolamento (UE) 2019/1150
            (&quot;P2B Regulation&quot;): mette in contatto Acquirenti e Venditori e facilita pagamenti
            e consegne. <strong>Il contratto di compravendita si conclude direttamente tra Acquirente
            e Venditore</strong>; MyCity non è parte di tale contratto e non è proprietario dei beni
            venduti.
          </p>
          <p>
            <strong>Ranking dei risultati di ricerca</strong> e visibilità dei prodotti dipendono da:
            (a) rilevanza testuale rispetto alla query; (b) distanza geografica dal punto di consegna
            dell&apos;Acquirente; (c) rating medio del Venditore; (d) disponibilità in stock e orari
            di apertura; (e) eventuale acquisto di posizionamento sponsorizzato (chiaramente etichettato
            come &quot;Sponsorizzato&quot;).
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">3. Registrazione e account</h2>
          <p>
            Per utilizzare il Servizio devi avere almeno <strong>18 anni</strong> e creare un account
            fornendo dati veritieri, completi e aggiornati. Sei responsabile della riservatezza delle
            credenziali e di ogni attività svolta tramite il tuo account.
          </p>
          <p>
            <strong>Verifica email</strong> obbligatoria. Per Venditori e Rider è inoltre richiesta
            la <strong>verifica KYC</strong> (documento d&apos;identità, codice fiscale, P.IVA se
            applicabile, IBAN, assicurazione RC per i Rider).
          </p>
          <p>
            Devi avvisarci immediatamente di ogni uso non autorizzato del tuo account scrivendo a{' '}
            <a href="mailto:security@mycity.it" className="text-indigo-600 underline">security@mycity.it</a>.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">4. Ordini e formazione del contratto</h2>
          <p>
            L&apos;invio dell&apos;ordine costituisce proposta di acquisto irrevocabile; il contratto
            si perfeziona con l&apos;accettazione del Venditore (che può rifiutare per indisponibilità
            o motivi giustificati). In caso di rifiuto, il pagamento è rimborsato integralmente.
          </p>
          <p>
            I prezzi sono comprensivi di IVA. Le spese di spedizione sono calcolate al checkout in
            base a peso, distanza e modalità di consegna scelta.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">5. Pagamenti</h2>
          <p>
            I pagamenti sono gestiti da provider PSP autorizzati (Stripe, S.A.). MyCity, in qualità
            di marketplace facilitator, incassa l&apos;importo dell&apos;ordine in custodia
            (&quot;<strong>escrow</strong>&quot;) e lo trasferisce al Venditore (al netto della
            commissione di servizio) dopo la conferma di consegna o, comunque, alla scadenza del
            periodo di recesso (14 giorni).
          </p>
          <p>
            Modalità accettate: carta di credito/debito (Visa, Mastercard, Amex), Apple Pay,
            Google Pay e, dove indicato dal Venditore, pagamento alla consegna in contanti.
          </p>
          <p>
            <strong>Fatturazione</strong>: per ogni ordine consegnato viene emessa fattura
            elettronica via SDI dal Venditore. Su richiesta dell&apos;Acquirente con P.IVA, la
            fattura è intestata all&apos;impresa indicata al checkout.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">6. Consegne</h2>
          <p>
            Le consegne sono affidate a Rider partner. I tempi indicati sono stimati e non
            vincolanti, salvo diversa garanzia espressa. È responsabilità dell&apos;Acquirente
            essere reperibile all&apos;indirizzo indicato; in caso di assenza il Rider tenterà
            il contatto telefonico e, in caso di esito negativo dopo tre tentativi, l&apos;ordine
            potrà essere annullato con rimborso al netto delle spese di consegna sostenute.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">7. Diritto di recesso (consumatori)</h2>
          <p>
            Ai sensi degli artt. 52 e ss. del D.Lgs. 206/2005 (Codice del Consumo), l&apos;Acquirente
            che agisce come consumatore ha diritto di recedere dal contratto entro{' '}
            <strong>14 giorni</strong> dalla consegna, senza necessità di motivare la richiesta.
          </p>
          <p>
            Sono esclusi dal recesso, ai sensi dell&apos;art. 59 Cod. Cons.: prodotti deperibili,
            prodotti confezionati su misura o personalizzati, prodotti sigillati (per igiene) aperti
            dopo la consegna, beni che dopo la consegna risultino mescolati con altri beni in modo
            non separabile, contenuti digitali forniti su supporto non materiale dopo l&apos;avvio
            dell&apos;esecuzione.
          </p>
          <p>
            Per esercitare il recesso usa il flusso &quot;Richiedi reso&quot; nel dettaglio ordine
            o scrivi a <a href="mailto:resi@mycity.it" className="text-indigo-600 underline">resi@mycity.it</a>.
            Le spese di restituzione sono a carico dell&apos;Acquirente salvo prodotto difettoso o
            errore del Venditore.
          </p>
          <p>
            Il rimborso è effettuato entro 14 giorni dalla ricezione della merce restituita, con lo
            stesso mezzo di pagamento usato per l&apos;acquisto.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">8. Garanzia legale di conformità</h2>
          <p>
            Per i consumatori si applica la <strong>garanzia legale di conformità di 24 mesi</strong>{' '}
            (D.Lgs. 170/2021). In caso di difetto, l&apos;Acquirente ha diritto, a sua scelta, alla
            riparazione o sostituzione gratuita; se non possibili, alla riduzione del prezzo o
            risoluzione del contratto.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">9. Obblighi dei Venditori</h2>
          <p>I Venditori si impegnano a:</p>
          <ul className="list-disc list-inside space-y-1">
            <li>pubblicare informazioni veritiere, complete e non ingannevoli;</li>
            <li>rispettare la normativa fiscale ed emettere regolare documentazione (scontrino/fattura via SDI);</li>
            <li>garantire la conformità dei prodotti e rispondere della garanzia legale;</li>
            <li>evadere gli ordini entro i tempi indicati o, in caso di impossibilità, annullarli tempestivamente;</li>
            <li>non vendere prodotti contraffatti, illegali o vietati ai minori senza adeguati controlli;</li>
            <li>collaborare nella gestione di dispute, resi e reclami.</li>
          </ul>
          <p>
            La <strong>commissione di servizio</strong> trattenuta da MyCity è pari all&apos;8% del
            valore dell&apos;ordine, IVA esclusa. Eventuali variazioni saranno comunicate con
            preavviso di 30 giorni come da art. 15.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">10. Obblighi dei Rider</h2>
          <p>
            I Rider operano come lavoratori autonomi o parasubordinati. Devono essere in possesso
            di assicurazione RC, patente di guida valida (se applicabile), idoneità sanitaria (se
            consegnano alimenti), e rispettare il codice della strada e le norme di igiene.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">11. Contenuti pubblicati dagli utenti</h2>
          <p>
            Recensioni, foto e domande pubblicate dagli Utenti devono essere veritieri, originali e
            non lesivi di diritti di terzi. MyCity si riserva il diritto di moderare, oscurare o
            rimuovere contenuti contrari ai presenti Termini, alla legge o al buon costume.
          </p>
          <p>
            Pubblicando Contenuti concedi a MyCity una licenza non esclusiva, gratuita e mondiale
            per ospitarli, riprodurli e mostrarli all&apos;interno del Servizio.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">12. Contenuti e condotte proibiti</h2>
          <p>È vietato:</p>
          <ul className="list-disc list-inside space-y-1">
            <li>pubblicare contenuti illegali, contraffatti, offensivi, ingannevoli, discriminatori;</li>
            <li>tentare di aggirare i sistemi di sicurezza o di rate limiting;</li>
            <li>effettuare scraping massivo del catalogo o reverse engineering;</li>
            <li>creare account multipli per ottenere bonus o ingannare il sistema referral;</li>
            <li>utilizzare il Servizio per attività di riciclaggio o finanziamento di attività illecite.</li>
          </ul>
          <p>
            La violazione comporta sospensione o cancellazione dell&apos;account, oltre ad azioni
            legali e segnalazione alle autorità competenti.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">13. Limitazione di responsabilità</h2>
          <p>
            MyCity fornisce il Servizio &quot;as is&quot; e non garantisce continuità ininterrotta o
            assenza di errori. Nei limiti consentiti dalla legge, MyCity non è responsabile per:
            (a) la qualità, conformità o sicurezza dei prodotti venduti dai Venditori;
            (b) eventuali ritardi nelle consegne; (c) danni indiretti, perdita di profitti o dati
            derivanti dall&apos;uso del Servizio.
          </p>
          <p>
            Resta ferma la responsabilità inderogabile di MyCity per dolo o colpa grave, danni alla
            persona e violazioni dei diritti dei consumatori.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">14. Sospensione e cessazione</h2>
          <p>
            MyCity può sospendere o chiudere il tuo account, dandone comunicazione, in caso di:
            (a) violazione dei Termini; (b) attività sospette di frode; (c) ordini interrogazione di
            autorità competenti. Puoi cancellare il tuo account in qualsiasi momento dalla pagina
            <Link href="/profile/settings" className="text-indigo-600 underline"> Impostazioni</Link>.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">15. Modifiche ai Termini</h2>
          <p>
            Possiamo modificare i presenti Termini in qualsiasi momento. Le modifiche sostanziali
            saranno comunicate con preavviso di <strong>30 giorni</strong> via email e notifica in
            piattaforma. L&apos;uso continuato del Servizio dopo l&apos;entrata in vigore costituisce
            accettazione delle modifiche. Se non accetti, puoi cancellare l&apos;account prima
            dell&apos;entrata in vigore.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">16. Risoluzione delle controversie (ODR)</h2>
          <p>
            Per i consumatori è disponibile la piattaforma europea di risoluzione delle controversie
            online (ODR):{' '}
            <a href="https://ec.europa.eu/consumers/odr/" target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline">
              ec.europa.eu/consumers/odr
            </a>.
            Inoltre, puoi contattare il nostro servizio clienti scrivendo a{' '}
            <a href="mailto:reclami@mycity.it" className="text-indigo-600 underline">reclami@mycity.it</a>.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">17. Legge applicabile e foro competente</h2>
          <p>
            I presenti Termini sono regolati dalla <strong>legge italiana</strong>. Per le controversie
            con consumatori è competente in via esclusiva il foro del luogo di residenza o domicilio
            del consumatore. Per le controversie con professionisti è competente il <strong>Foro di
            Piacenza</strong>.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">18. Contatti</h2>
          <p>
            Per domande sui Termini scrivi a{' '}
            <a href="mailto:legal@mycity.it" className="text-indigo-600 underline">legal@mycity.it</a>{' '}
            oppure utilizza la <Link href="/contact" className="text-indigo-600 underline">pagina contatti</Link>.
          </p>
        </section>
      </div>

      <div className="mt-10 p-4 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">
        <strong>Avviso legale:</strong> questo documento è un modello di partenza ispirato alla
        normativa italiana ed europea (Cod. Cons., GDPR, P2B Regulation, D.Lgs. 170/2021).
        Prima del lancio in produzione DEVE essere validato da un avvocato esperto in diritto
        del consumo e marketplace digitali.
      </div>
    </div>
  );
}
