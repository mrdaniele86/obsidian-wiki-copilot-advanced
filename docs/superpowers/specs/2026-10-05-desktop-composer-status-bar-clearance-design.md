# Spazio composer desktop sopra la barra di stato

## Obiettivo

Impedire che il pulsante Invia di Wiki Copilot venga coperto dalla barra di stato di Obsidian sul desktop, senza cambiare il layout mobile.

## Design

Il solo selettore desktop `.wiki-copilot-composer` riserva spazio inferiore tramite la variabile Obsidian della barra di stato, con fallback zero. La regola è esclusa dai selettori `body.is-mobile` già dedicati a tastiera virtuale e navigazione mobile.

Non cambia struttura DOM, altezza della textarea, azioni del composer, invio normale, né CSS mobile. Il test di regressione verifica che la regola desktop esista e che non sia applicata dal selettore mobile.
