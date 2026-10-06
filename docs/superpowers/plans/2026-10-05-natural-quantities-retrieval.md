# Natural Quantities and Retrieval Plan

**Spec:** `docs/superpowers/specs/2026-10-05-natural-quantities-retrieval-design.md`

1. Add tokenizer regressions for quantities and ordinary word-plus-count prose;
   keep the existing identifier cases as controls.
2. Add a retrieval regression with a `Piano alimentare` curated note and the
   exact dinner wording from the report.
3. Run those tests to demonstrate the current false identifier behavior.
4. Narrow strict identifier extraction so natural quantities and ordinary prose
   cannot synthesize a hard identifier from a preceding word.
5. Re-run focused tests, then the full checks and artifact verification.
6. Review the diff; do not version, tag, push, or publish.
