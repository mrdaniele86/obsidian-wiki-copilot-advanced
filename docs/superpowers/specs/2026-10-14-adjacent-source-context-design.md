# Adjacent Source Context Design

## Goal

Ensure precise retrieval supplies adjacent sections of a selected Markdown note when the answer depends on both sections.

## Scope

After precise retrieval selects a chunk from a source note, include its immediately following chunk from the same note when it fits the existing context budget. Do not alter ranking, cross-note retrieval, or the maximum-context limit.

## Rationale

The current per-section relevance filter can select a matrix table while dropping the next section that defines its calculation. The Garmin compatibility note reproduces this: the matrix base is selected, while the weighting and corrective table is omitted.

## Design

Add a bounded post-selection expansion to the precise full-Markdown retrieval path. It will preserve the selected chunk, append the next sibling chunk by `chunkIndex` and `path`, avoid duplicates, and stop when the configured context budget would be exceeded. Citations remain one source per included chunk, preserving their heading and path.

## Acceptance criteria

- A selected matrix chunk returns its next same-note section when the latter fits the budget.
- The adjacent chunk is not duplicated when already selected independently.
- No chunk from a different note is added.
- Existing context-budget behavior remains enforced.
