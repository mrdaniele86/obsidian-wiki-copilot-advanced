import { describe, expect, it } from "vitest";
import {
  classifyKnowledgePath,
  discoverKnowledgeProfile,
  extractQueryGuidance,
  isExcludedPath
} from "../src/core/profile";

const paths = [
  "AGENTS.md",
  "index.md",
  "wiki/topics/制动.md",
  "wiki/concepts/压力.md",
  "wiki/summaries/规范摘要.md",
  "raw/processed/codes/md/规范.md",
  "raw/pending/codes/md/草稿.md",
  ".obsidian/plugins/example.md"
];

describe("knowledge profile", () => {
  it("discovers the persistent Wiki layers and classifies their roles", () => {
    const profile = discoverKnowledgeProfile(paths, {
      "AGENTS.md": "Query 时先读 `index.md`，再读 `wiki/`，必要时回查 `raw/processed/`；不要默认使用 `raw/pending/`。"
    });

    expect(profile.schemaFiles).toContain("AGENTS.md");
    expect(profile.wikiRoots).toContain("wiki");
    expect(profile.stableSourceRoots).toContain("raw/processed");
    expect(profile.pendingSourceRoots).toContain("raw/pending");
    expect(classifyKnowledgePath("wiki/topics/制动.md", profile)).toBe("topic");
    expect(classifyKnowledgePath("wiki/concepts/压力.md", profile)).toBe("concept");
    expect(classifyKnowledgePath("wiki/summaries/规范摘要.md", profile)).toBe("summary");
    expect(classifyKnowledgePath("raw/processed/codes/md/规范.md", profile)).toBe("stable-source");
    expect(classifyKnowledgePath("raw/pending/codes/md/草稿.md", profile)).toBe("pending-source");
    expect(isExcludedPath(".obsidian/plugins/example.md", profile)).toBe(true);
  });

  it("discovers equivalent Wiki philosophies without project-specific folder names", () => {
    const genericPaths = [
      "CLAUDE.md",
      "knowledge/topics/Retrieval.md",
      "knowledge/concepts/Chunk.md",
      "knowledge/summaries/Paper.md",
      "sources/curated/paper.md",
      "sources/inbox/draft.md"
    ];
    const profile = discoverKnowledgeProfile(genericPaths, {
      "CLAUDE.md": "Use `knowledge/` as the maintained wiki. `sources/curated/` is the stable source layer and `sources/inbox/` is pending."
    });

    expect(profile.wikiRoots).toContain("knowledge");
    expect(profile.stableSourceRoots).toContain("sources/curated");
    expect(profile.pendingSourceRoots).toContain("sources/inbox");
    expect(classifyKnowledgePath("knowledge/topics/Retrieval.md", profile)).toBe("topic");
    expect(classifyKnowledgePath("sources/curated/paper.md", profile)).toBe("stable-source");
    expect(classifyKnowledgePath("sources/inbox/draft.md", profile)).toBe("pending-source");
  });

  it("does not let a mixed status description turn the whole source tree into pending", () => {
    const profile = discoverKnowledgeProfile([
      "AGENTS.md",
      "wiki/topics/Test.md",
      "raw/processed/md/source.md"
    ], {
      "AGENTS.md": "`raw/` 下的来源按状态进入 `pending/` 或 `processed/`。稳定资料位于 `raw/processed/`，待处理资料位于 `raw/pending/`。"
    });

    expect(classifyKnowledgePath("raw/processed/md/source.md", profile)).toBe("stable-source");
    expect(profile.pendingSourceRoots).not.toContain("raw");
  });

  it("extracts only the Query section for model guidance", () => {
    const guidance = extractQueryGuidance(`# Schema

## Ingest
Do ingest things.

## Query
Read index first.

### Evidence
Use stable sources.

## Lint
Do lint things.
`);
    expect(guidance).toContain("Read index first");
    expect(guidance).toContain("Use stable sources");
    expect(guidance).not.toContain("Do lint things");
  });
});
