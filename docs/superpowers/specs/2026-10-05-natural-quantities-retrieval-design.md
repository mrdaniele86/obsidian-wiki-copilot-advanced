# Natural Quantities and Retrieval Design

## Problem

Natural-language quantities such as `mangiato 200gr` are merged by the
spaced-identifier tokenizer into synthetic identifiers such as `mangiato200gr`.
The identifier path then restricts retrieval to exact technical matches and may
show a false missing-identifier message instead of retrieving a relevant note.

## Goals

- Treat food, volume, mass, and calorie quantities as prose, not strict product
  or document identifiers.
- Preserve strict matching for genuine identifiers such as `MS6`, `PCBA-001`,
  and `Python 3`.
- Let an initial question containing `piano alimentare` retrieve a matching
  curated note even when it also contains a quantity.

## Non-goals

- No semantic guessing, broadening of unrelated searches, model changes,
  settings changes, or publication.

## Acceptance criteria

1. `200gr`, `200 g`, `200 grammi`, `250ml`, `180 kcal`, and ordinary prose
   followed by a bare count such as `mangiato 2 uova` produce no strict
   identifier derived from the preceding prose word.
2. `MS6`, `PCBA-001`, and `Python 3` retain their existing identifier behavior.
3. A curated `Piano alimentare` note is retrieved for the reported dinner
   question containing `200gr` and `piano alimentare`.
