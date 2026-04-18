import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DRIZZLE_DIR = path.resolve(process.cwd(), "drizzle");
const JOURNAL_PATH = path.join(DRIZZLE_DIR, "meta", "_journal.json");

describe("drizzle migration metadata", () => {
  it("lists every SQL migration in the journal in strict timestamp order", () => {
    const journal = JSON.parse(fs.readFileSync(JOURNAL_PATH, "utf8")) as {
      entries: Array<{ when: number; tag: string }>;
    };
    const sqlTags = fs
      .readdirSync(DRIZZLE_DIR)
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .map((name) => name.replace(/\.sql$/, ""));
    const journalTags = journal.entries.map((entry) => entry.tag);
    const journalWhens = journal.entries.map((entry) => entry.when);

    expect(journalTags).toEqual(sqlTags);
    expect(journalWhens).toEqual([...journalWhens].sort((a, b) => a - b));
    expect(new Set(journalWhens).size).toBe(journalWhens.length);
  });
});
