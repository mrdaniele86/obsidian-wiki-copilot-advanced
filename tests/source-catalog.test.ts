import { describe, expect, it } from "vitest";
import { SourceCatalogIndex } from "../src/core/source-catalog";

describe("source catalog exact identifier lookup", () => {
  it("keeps exact model documents even when generic subject hits dominate the lexical candidates", () => {
    const catalog = new SourceCatalogIndex({ useWorker: false });
    for (let index = 0; index < 100; index += 1) {
      catalog.replace({
        path: `raw/processed/MC2-B-power-${index}.md`,
        title: `MC2-B 功耗测试 ${index}`,
        aliases: "",
        tags: "",
        headings: "功耗 测试 电流 电压",
        role: "stable-source"
      });
    }
    catalog.replace({
      path: "raw/processed/R100014546_MS6-V-WT-H.md",
      title: "Technical Specification of Circuit Board MS6-V-WT-H",
      aliases: "",
      tags: "",
      headings: "Content",
      role: "stable-source"
    });

    const hits = catalog.search("所有ms6功耗", false, 8);

    expect(hits).toHaveLength(1);
    expect(hits[0]?.path).toContain("MS6");
    catalog.destroy();
  });

  it("updates the exact identifier mapping when a catalog path is replaced or removed", () => {
    const catalog = new SourceCatalogIndex({ useWorker: false });
    const path = "raw/processed/spec.md";
    catalog.replace({
      path,
      title: "MS6 specification",
      aliases: "",
      tags: "",
      headings: "Power",
      role: "stable-source"
    });
    expect(catalog.search("MS6", false)).toHaveLength(1);

    catalog.replace({
      path,
      title: "MC2 specification",
      aliases: "",
      tags: "",
      headings: "Power",
      role: "stable-source"
    });
    expect(catalog.search("MS6", false)).toHaveLength(0);
    expect(catalog.search("MC2", false)).toHaveLength(1);

    catalog.remove(path);
    expect(catalog.search("MC2", false)).toHaveLength(0);
    catalog.destroy();
  });

  it("clears exact identifier paths during an asynchronous catalog rebuild", async () => {
    const catalog = new SourceCatalogIndex({ useWorker: false });
    catalog.replace({
      path: "raw/processed/MS6.md",
      title: "MS6 specification",
      aliases: "",
      tags: "",
      headings: "Power",
      role: "stable-source"
    });

    await catalog.clearAsync();

    expect(catalog.hasIdentifier("ms6")).toBe(false);
    expect(catalog.search("MS6", false)).toHaveLength(0);
    catalog.destroy();
  });
});
