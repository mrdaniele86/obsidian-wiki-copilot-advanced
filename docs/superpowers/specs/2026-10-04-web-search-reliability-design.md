# Affidabilità e privacy della ricerca web

## Obiettivo

Preparare la beta successiva di Wiki Copilot Advanced rendendo la ricerca web Gemini più affidabile senza cambiare il normale invio chat né la ricerca nel Vault.

La ricerca web resta un'azione esplicita, disponibile solo con provider Gemini dedicato, chiave separata e consenso di sessione. La cronologia recente resta disattivata per impostazione predefinita e non viene mai inviata senza un consenso che lo dichiari.

## Cancellazione delle richieste

Ogni ricerca web avviata dalla vista possiede un proprio `AbortController`. La vista annulla la richiesta ancora attiva quando l'utente interrompe l'operazione, crea una nuova conversazione, chiude la vista o avvia una nuova ricerca web.

Il segnale passa dalla vista al main plugin, al servizio web e al client Gemini. Il timeout di 30 secondi resta autonomo: un annullamento dell'utente produce l'errore tipizzato `cancelled`, mentre il timeout produce `timeout`. Una ricerca annullata non salva un turno assistente, non salva fonti web e non mostra un errore generico di rete.

## Dati web nello storico

I metadati web letti da Markdown sono dati non fidati. Una risposta web salvata è valida soltanto se:

- il provider è Gemini;
- domanda, modello e risposta sono stringhe non vuote entro limiti ragionevoli;
- contiene da una a dodici fonti;
- ogni URL è HTTPS e rientra nel limite di lunghezza;
- titoli e identificatori rientrano nei limiti di lunghezza.

Se il blocco web non è valido, viene ignorato conservando il turno assistente e le fonti Vault legacy eventualmente valide. Questo allinea il parser persistente alle garanzie della risposta Gemini live.

## Capacità configurabili

L'unico provider web selezionabile è Gemini dedicato. Il valore storico `current-provider` viene gestito in modo difensivo come disabilitato e non abilita mai la ricerca web, non riusa la chiave del provider chat e non compare tra le opzioni dell'interfaccia.

## Verifica per release

La checklist BRAT non deve riferirsi a una beta specifica e deve includere un controllo mobile per: pulsante Web compatto, configurazione Gemini, consenso, annullamento e separazione delle fonti. I test di integrazione devono osservare il comportamento invece di dipendere da frammenti testuali del sorgente.

## Vincoli invariati

- Nessuna nota del Vault, nota attiva o cronologia completa viene inviata alla ricerca web.
- Il contesto recente è opzionale, limitato e richiede consenso specifico.
- Il pulsante Invia e il flusso Vault restano invariati.
- Nessun nuovo provider, dipendenza, embedding o accesso al provider chat.
