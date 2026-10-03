# Mappa di conoscenza separata e instradamento della ricerca

## Obiettivo

Migliorare il primo passaggio della ricerca di Wiki Copilot Advanced costruendo una mappa semantica separata del Vault. La mappa suggerisce un piccolo insieme iniziale di note pertinenti; non sostituisce mai l'indice né la ricerca globale esistenti.

L'utente deve poter disattivare completamente la funzione o scegliere quanto usare l'AI nella generazione della mappa.

## Non obiettivi

- Non modificare i Markdown originali dell'utente.
- Non sostituire l'indice, il recupero preciso, il recupero veloce, le citazioni o il fallback corrente.
- Non introdurre un servizio remoto obbligatorio o nuove credenziali.
- Non usare la mappa come fonte da citare nella risposta: le citazioni continuano a puntare alle note originali.

## Architettura

### Archivio della mappa

Il plugin crea una cartella dedicata e riconoscibile, configurabile in seguito se necessario, con valore predefinito `Wiki Copilot/Mappa`.

La cartella contiene un file Markdown generato per ogni nota sorgente inclusa nell'indice. Ogni file conserva:

- percorso e titolo della nota sorgente;
- data o firma dell'ultima analisi;
- concetti e parole chiave rilevanti;
- wikilink verso note correlate;
- un punteggio e una breve motivazione per ogni relazione;
- l'origine della relazione: locale, AI o entrambe.

I file della mappa sono artefatti rigenerabili: l'utente può eliminarli e rigenerarli senza perdere dati del Vault. Sono esclusi dalla normale indicizzazione e non diventano materiale per le risposte.

### Generazione locale

La generazione locale non usa servizi AI. Produce relazioni usando segnali deterministici: wikilink già presenti, backlink, titoli, alias, tag, cartella e sovrapposizione di parole chiave.

È gratuita, riproducibile e disponibile anche senza configurazione del modello, ma non può riconoscere bene sinonimi o legami concettuali impliciti.

### Generazione AI

Quando l'utente abilita l'AI, il modello già configurato nel plugin riceve soltanto il materiale necessario per analizzare note nuove o modificate e proporre relazioni semantiche. L'output deve avere schema validabile e limiti espliciti sul numero di relazioni, per evitare mappe troppo dense o costose.

L'AI non scrive note dell'utente: il plugin valida il risultato e aggiorna solo i file nella cartella della mappa. Errori, assenza di configurazione o timeout mantengono le relazioni locali disponibili e non bloccano l'uso del plugin.

### Modalità impostazioni

Una nuova sezione **Mappa di conoscenza** nelle impostazioni offre una singola scelta di modalità:

| Modalità | Comportamento |
| --- | --- |
| Disattivata | Non crea né consulta la mappa; la ricerca resta identica a quella attuale. |
| Solo locale | Genera e consulta solo relazioni deterministiche locali. |
| Solo AI | Genera relazioni semantiche con il modello configurato; senza modello funzionante segnala il problema e non modifica la mappa. |
| Ibrida | Costruisce la base locale e la arricchisce con l'AI; è la modalità consigliata. |

La sezione include un comando **Aggiorna mappa**. In una fase successiva potrà offrire l'aggiornamento automatico limitato alle note nuove o modificate; l'impostazione è disabilitata per impostazione predefinita per mantenere il consumo AI esplicito e prevedibile.

## Flusso di ricerca

1. La domanda viene trasformata nella query di recupero già esistente.
2. Se la mappa è disattivata o non disponibile, il plugin segue invariato il recupero attuale.
3. Se disponibile, il router cerca nodi mappa coerenti con query, note attive e termini identificativi.
4. I percorsi correlati diventano candidati prioritari nel recupero normale: non bypassano né alterano il ranking di evidenze del retriever.
5. Il plugin valuta copertura e pertinenza dei risultati iniziali. Se non raggiungono una soglia definita, esegue automaticamente la ricerca globale corrente.
6. Il contesto finale e le citazioni sono costruiti esclusivamente dai frammenti delle note sorgenti recuperate.

La ricerca globale è quindi sempre il piano B affidabile e rimane il comportamento di sicurezza per domande trasversali, mappe assenti, mappe non aggiornate e richieste senza relazioni utili.

## Affidabilità, privacy e costi

- La modalità disattivata non effettua elaborazioni aggiuntive.
- La modalità locale non invia dati fuori dal dispositivo.
- La modalità AI esplicita prima dell'aggiornamento che userà il provider e la chiave già configurati.
- Gli aggiornamenti AI elaborano solo note cambiate e mantengono una firma dell'ultima elaborazione per evitare chiamate duplicate.
- Un fallimento nella mappa non blocca indice, chat o risposta: viene registrato e la ricerca globale prosegue.

## Esperienza utente

- Lo stato della mappa indica se è assente, aggiornata, da aggiornare, in aggiornamento o con errori.
- L'azione manuale mostra avanzamento e un riepilogo finale: note analizzate, relazioni create e note saltate.
- Le relazioni generate restano ispezionabili nei file Markdown della cartella separata.
- Non sono previste modifiche all'interfaccia chat oltre a un eventuale messaggio di avanzamento durante l'aggiornamento della mappa.

## Verifica futura

- Test unitari per estrazione locale, fusione AI, deduplicazione e rilevamento di note modificate.
- Test del router: usa prima candidati mappa, ma esegue sempre fallback globale sotto soglia.
- Test di regressione: modalità disattivata segue identicamente il percorso di recupero esistente.
- Test di integrazione per cartella mappa esclusa dall'indice e citazioni sempre riferite alla nota sorgente.
- Test delle impostazioni e delle traduzioni IT/EN/ZH.

## Decisioni confermate

- La mappa è separata dalle note originali.
- Le modalità richieste sono: disattivata, solo locale, solo AI e ibrida.
- La modalità ibrida è consigliata, ma non obbligatoria.
- L'aggiornamento AI viene progettato per essere incrementale e controllato dall'utente.
- La mappa agevola la prima ricerca, mentre la ricerca globale attuale rimane sempre disponibile come fallback.
