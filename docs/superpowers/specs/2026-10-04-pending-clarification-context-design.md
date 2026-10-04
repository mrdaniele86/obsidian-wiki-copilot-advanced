# Contesto dei chiarimenti pendenti

## Obiettivo

Impedire che una risposta breve a una domanda di chiarimento venga interpretata come un nuovo quesito indipendente. Il plugin deve recuperare l'obiettivo originale, la domanda di chiarimento e i dati raccolti prima di pianificare retrieval o generare la risposta.

La soluzione è generica: non introduce regole hardcoded per allenamenti, nutrizione o altri domini.

## Stato di chiarimento pendente

Una conversazione può avere al massimo un chiarimento pendente. Lo stato locale e persistibile contiene:

- obiettivo originale dell'utente;
- domanda di chiarimento posta dall'assistente;
- campi o dati ancora necessari, espressi in linguaggio naturale;
- indice o identificatore dei turni di origine;
- numero di turni trascorsi dalla richiesta.

Lo stato viene creato soltanto quando la risposta dell'assistente dichiara esplicitamente che mancano dati per completare l'obiettivo. Non viene dedotto da ogni domanda generica dell'assistente.

## Marcatore strutturato dell'assistente

Il prompt del modello richiede un solo marcatore HTML nascosto alla fine della risposta quando serve un chiarimento:

```html
<!-- wiki-copilot-clarification {"goal":"...","question":"...","missing":"...","requiresSummary":true} -->
```

Il plugin estrae il marcatore, ne valida JSON, campi non vuoti e limiti di lunghezza, poi lo rimuove dal Markdown visualizzato e salvato come testo della risposta. I dati validati vengono salvati come metadati del turno assistente. Se il marcatore è assente o invalido, non esiste chiarimento pendente e il comportamento rimane quello corrente.

Il modello non inserisce il marcatore quando può rispondere direttamente. `requiresSummary` è vero soltanto se la decisione finale richiede più dati correlati.

## Risoluzione del chiarimento

Quando arriva il turno utente successivo mentre esiste uno stato valido, il plugin costruisce un contesto di continuità locale:

```text
Obiettivo originale: ...
Chiarimento richiesto: ...
Risposta ricevuta: ...
Completa l'obiettivo originale; non trattare la risposta ricevuta come un nuovo quesito.
```

Questo contesto viene passato sia al planner di retrieval sia al modello chat. Il retrieval continua a usare il Vault normalmente, ma la sua query è ancorata all'obiettivo originale e non soltanto all'ultima risposta breve.

Nel caso allenamento:

```text
Obiettivo originale: consigliare il prossimo allenamento dopo Tempo.
Chiarimento richiesto: quale allenamento è stato svolto immediatamente prima di Tempo?
Risposta ricevuta: Soglia.
```

La risposta deve trattare `Soglia` come penultimo allenamento e `Tempo` come ultimo, non rispondere come se l'utente avesse chiesto cosa fare dopo Soglia.

## Riepilogo esplicito

Il modello apre la risposta finale con un riepilogo dei dati raccolti quando `requiresSummary` è vero. Il riepilogo fa parte della risposta finale: non crea una chiamata modello aggiuntiva né richiede un turno di conferma all'utente.

Per chiarimenti a campo singolo, la risposta prosegue senza riepilogo aggiuntivo salvo che il modello lo ritenga necessario per evitare ambiguità.

## Scadenza e annullamento

Lo stato viene eliminato quando:

- l'utente avvia una nuova conversazione;
- l'utente pone una nuova domanda esplicita che sostituisce l'obiettivo;
- il chiarimento viene completato;
- trascorrono più di due turni utente senza completamento;
- lo storico viene letto ma lo stato non è coerente con i turni conservati.

Se lo stato non è disponibile o non è affidabile, il plugin non deduce i dati mancanti: l'assistente deve chiederli insieme, indicando ordine e significato richiesti.

## Persistenza e privacy

Lo stato viene serializzato insieme alla conversazione e ricaricato solo se supera la validazione. Non viene inviato a nuovi provider: è contesto locale incluso nella normale richiesta chat già configurata dall'utente.

Il flusso Web, le impostazioni SerpApi progettate separatamente, le chiavi e il consenso web non cambiano.

## Criteri di accettazione

- Con `Oggi ho fatto Tempo, quale è il prossimo?` seguito dalla domanda di chiarimento e dalla risposta `Prima ho fatto Soglia`, planner e modello ricevono insieme Soglia, Tempo e obiettivo originale.
- La risposta non raccomanda un'attività come se Soglia fosse l'ultimo allenamento.
- La risposta mostra il riepilogo di penultimo e ultimo prima della proposta quando la decisione dipende da entrambi.
- Una nuova domanda, una nuova conversazione e uno stato obsoleto non contaminano richieste successive.
- Conversazioni senza chiarimenti pendenti conservano il comportamento attuale.
