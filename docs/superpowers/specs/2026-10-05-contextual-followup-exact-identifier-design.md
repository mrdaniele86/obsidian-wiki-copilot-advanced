# Follow-up conversazionali con identificatore esatto assente

## Problema

Con “Includi contesto conversazione recente” attivo, un messaggio successivo come “Ho fatto 8x300 e poi Tempo” può non trovare una fonte Vault con identificatore esatto. `main.answer` restituisce allora il fallback locale prima di chiamare il modello, quindi la cronologia attiva non viene mai usata.

## Design

Il fallback `exactIdentifierMissingMessage` resta per richieste isolate: protegge da sostituzioni di entità non supportate. Viene però saltato quando la cronologia conversazionale è effettivamente abilitata e contiene almeno un turno; il modello riceve allora domanda, cronologia e assenza di evidenze, e può trattare il messaggio come un follow-up dell'obiettivo precedente.

Il bypass non si applica a recovery con contesto ridotto, all'opzione cronologia disattivata, né a conversazioni vuote. Retrieval, ranking, fonti persistite, consenso e Web restano invariati.

## Verifica

Un test riproduce il follow-up `8x300` con cronologia attiva e retrieval senza chunk: verifica che il client LLM sia chiamato con la cronologia invece del fallback locale. Un test di controllo conserva il fallback per una richiesta isolata. Conclusione: `pnpm check`, `pnpm verify:brat-beta`, revisione diff; nessun tag/push/release senza conferma.
