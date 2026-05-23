import Link from 'next/link';

export const metadata = {
  title: 'Termini di servizio · MyCity',
  description: 'Termini e condizioni d\'uso del marketplace MyCity.',
};

export default function TermsPage() {
  return (
    <div className="container mx-auto px-6 py-10 max-w-3xl">
      <div className="mb-8">
        <Link href="/" className="text-sm text-indigo-600 hover:underline">← Home</Link>
        <h1 className="text-3xl md:text-4xl font-extrabold text-gray-900 mt-2 mb-2">Termini di servizio</h1>
        <p className="text-sm text-gray-500">Ultimo aggiornamento: 1° gennaio 2026</p>
      </div>

      <div className="prose prose-gray max-w-none space-y-6 text-gray-700 leading-relaxed">
        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">1. Premesse</h2>
          <p>I presenti Termini di Servizio ("Termini") regolano l'utilizzo della piattaforma MyCity (il "Servizio"),
          gestita da <strong>MyCity S.r.l.</strong>, con sede in Via Roma 1, 29121 Piacenza (PC), Italia, P.IVA IT00000000000 (di seguito "MyCity", "noi").</p>
          <p>Accedendo o utilizzando il Servizio accetti integralmente i presenti Termini. Se non sei d'accordo, non utilizzare la piattaforma.</p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">2. Descrizione del servizio</h2>
          <p>MyCity è un marketplace che mette in contatto venditori locali ("Venditori") con acquirenti ("Acquirenti") e
          rider partner per la consegna degli ordini. MyCity non è parte del contratto di compravendita: il contratto si
          conclude direttamente tra Acquirente e Venditore.</p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">3. Registrazione e account</h2>
          <p>Per utilizzare il Servizio devi avere almeno 18 anni e creare un account fornendo dati veritieri e completi.
          Sei responsabile della riservatezza delle credenziali. Devi avvisarci subito di ogni uso non autorizzato.</p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">4. Ordini, prezzi e pagamenti</h2>
          <p>I prezzi e la disponibilità dei prodotti sono fissati dai Venditori e possono variare. Il Venditore conferma
          l'ordine; in caso di indisponibilità sopravvenuta, l'ordine può essere annullato e rimborsato.</p>
          <p>Il pagamento avviene secondo le modalità indicate al checkout (attualmente: pagamento alla consegna).</p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">5. Consegne</h2>
          <p>Le consegne sono gestite dal Venditore o da un rider partner. I tempi di consegna sono indicativi (24-48h).
          Eventuali ritardi non danno diritto a risarcimenti automatici salvo diversa pattuizione.</p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">6. Diritto di recesso</h2>
          <p>L'Acquirente consumatore ha diritto di recedere dal contratto entro 14 giorni dalla consegna, ai sensi del
          D.Lgs. 206/2005. Le spese di restituzione sono a carico dell'Acquirente, salvo prodotto difettoso o errore del
          Venditore. Maggiori dettagli su <Link href="/returns" className="text-indigo-600 underline">Resi e rimborsi</Link>.</p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">7. Obblighi dei Venditori</h2>
          <p>I Venditori si impegnano a: pubblicare informazioni veritiere, rispettare la normativa fiscale, emettere
          scontrino/fattura, evadere gli ordini nei tempi indicati, garantire la conformità dei prodotti.</p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">8. Contenuti proibiti</h2>
          <p>È vietato pubblicare contenuti illegali, contraffatti, offensivi, ingannevoli o lesivi di diritti di terzi.
          MyCity si riserva il diritto di rimuovere contenuti e sospendere account non conformi.</p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">9. Limitazione di responsabilità</h2>
          <p>MyCity fornisce la piattaforma "as is". Nei limiti consentiti dalla legge, MyCity non è responsabile per
          danni indiretti, perdita di profitti o dati derivanti dall'uso del Servizio. Resta ferma la responsabilità
          inderogabile per dolo o colpa grave.</p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">10. Modifiche</h2>
          <p>Possiamo modificare i presenti Termini con preavviso di 15 giorni via email o notifica in piattaforma. L'uso
          continuato del Servizio costituisce accettazione delle modifiche.</p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">11. Legge applicabile e foro</h2>
          <p>I presenti Termini sono regolati dalla legge italiana. Per le controversie con consumatori è competente il
          foro del luogo di residenza o domicilio del consumatore. Per le controversie con professionisti è competente il
          Foro di Piacenza.</p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">12. Contatti</h2>
          <p>Per domande sui Termini scrivi a <a href="mailto:info@mycity.it" className="text-indigo-600 underline">info@mycity.it</a> oppure utilizza la <Link href="/contact" className="text-indigo-600 underline">pagina contatti</Link>.</p>
        </section>
      </div>

      <div className="mt-10 p-4 bg-gray-50 rounded-lg text-xs text-gray-500">
        Questi termini sono un modello generico e non sostituiscono la consulenza di un avvocato.
        Prima del lancio in produzione fai validare il testo a un legale.
      </div>
    </div>
  );
}
