# Rapporto dell'imprenditore: proposte di testo per privacy e termini

26/11/2026. **Sono solo proposte: questa PR non le pubblica.** Nascono dal parere legale dell'AD (`ad-mycity/consegne/legale/2026-11-26-fonti-rapporto-imprenditore.md`), che è ancora una bozza. Prima di metterle in /privacy e in /terms le deve leggere un legale abilitato.

## 1. Informativa per i titolari: le fonti del rapporto

Da aggiungere all'informativa privacy, nella parte per chi vende su MyCity.

> **Il rapporto sulla tua attività.** Quando iscrivi la tua attività prepariamo un rapporto su come va online, e dopo l'abbonamento lo aggiorniamo. Usiamo solo dati dell'attività, mai dati personali del titolare. Le fonti sono:
> - **OpenStreetMap**: le attività simili vicino a te;
> - **Google PageSpeed Insights**: la velocità e la qualità del tuo sito;
> - **i profili pubblici dell'attività** su Instagram, Facebook e TikTok: follower e post;
> - **DataForSEO**: quante persone cercano la tua attività su Google, in che posizione compari, e i temi delle recensioni pubbliche (solo i temi, contati);
> - **fonti pubbliche**: il sito del Comune per eventi e bandi, le previsioni meteo;
> - **MyCity**: i dati del tuo negozio sul marketplace.
>
> La tua scheda Google la mostriamo solo nel riquadro ufficiale di Google, caricato da Google mentre guardi la pagina: dei dati di Google teniamo solo l'identificativo della scheda (`place_id`). Il nome Instagram e il link della scheda Google Maps che puoi scrivere all'iscrizione sono facoltativi: ci servono a trovare i profili giusti. Accanto a ogni dato del rapporto scriviamo la fonte e la data in cui l'abbiamo letto.

## 2. Informativa per chi scrive recensioni (art. 14.5.b GDPR)

Da pubblicare come pagina o paragrafo a sé, raggiungibile dall'informativa (per esempio /privacy#recensioni).

> **Se hai scritto una recensione pubblica su un'attività iscritta a MyCity.** Per preparare il rapporto all'attività leggiamo, tramite DataForSEO, le recensioni pubbliche che la riguardano. Lo facciamo per legittimo interesse: aiutare l'attività a capire cosa piace e cosa no ai suoi clienti. Delle recensioni teniamo solo i **temi** (per esempio «il servizio», «i dolci») e **quante recensioni li citano**, e solo per i temi citati da almeno 3 recensioni. Non salviamo né mostriamo il testo delle recensioni, il nome di chi le ha scritte o le foto. Non ti scriviamo e non ti contattiamo. Informarti una per una sarebbe impossibile, o richiederebbe uno sforzo sproporzionato (art. 14, paragrafo 5, lettera b del GDPR): per questo pubblichiamo questa informativa. Puoi opporti in qualunque momento scrivendo a [contatto privacy di MyCity].

## 3. Termini d'uso di MyCity: Google Maps

Da aggiungere ai termini d'uso (/terms), nella parte sui servizi di terzi.

> Alcune pagine di MyCity mostrano contenuti di Google Maps (il riquadro della scheda Google di un'attività). Se li usi, accetti anche i [Termini aggiuntivi di Google Maps / Google Earth](https://maps.google.com/help/terms_maps/) e l'[Informativa sulla privacy di Google](https://policies.google.com/privacy).

## Note per chi le pubblica

- Il riquadro di Google parte solo quando Nicola scrive la chiave `NEXT_PUBLIC_GOOGLE_MAPS_CHIAVE`. Il paragrafo 3 serve da quel giorno, e conviene pubblicarlo insieme alla chiave.
- Nell'elenco dei fornitori (`docs/dpa-vendors.md`) vanno aggiunti DataForSEO e Google Maps Platform, quando si accendono.
- TripAdvisor resta spento: non è nell'elenco delle fonti e non va aggiunto finché non si accende.
