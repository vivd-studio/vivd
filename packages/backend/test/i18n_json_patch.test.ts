import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  applyI18nJsonPatches,
  type I18nJsonPatch,
} from "../src/services/I18nJsonPatchService";

describe("I18nJsonPatchService", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("Update existing key in existing file", () => {
    fs.mkdirSync(path.join(tempDir, "locales"));
    fs.writeFileSync(
      path.join(tempDir, "locales", "en.json"),
      JSON.stringify({ "hero.title": "Old Title" }, null, 2)
    );

    const patches: I18nJsonPatch[] = [
      { key: "hero.title", lang: "en", value: "New Title" },
    ];
    const result = applyI18nJsonPatches(tempDir, patches);

    expect(result.applied).toBe(1);
    expect(result.skipped).toBe(0);
    const content = JSON.parse(
      fs.readFileSync(path.join(tempDir, "locales", "en.json"), "utf-8")
    );
    expect(content["hero.title"]).toBe("New Title");
  });

  it("Add new key to existing file", () => {
    fs.mkdirSync(path.join(tempDir, "locales"));
    fs.writeFileSync(
      path.join(tempDir, "locales", "en.json"),
      JSON.stringify({ "hero.title": "Title" }, null, 2)
    );

    const patches: I18nJsonPatch[] = [
      { key: "nav.home", lang: "en", value: "Home" },
    ];
    const result = applyI18nJsonPatches(tempDir, patches);

    expect(result.applied).toBe(1);
    const content = JSON.parse(
      fs.readFileSync(path.join(tempDir, "locales", "en.json"), "utf-8")
    );
    expect(content["hero.title"]).toBe("Title");
    expect(content["nav.home"]).toBe("Home");
  });

  it("Create new locale file when none exists", () => {
    const patches: I18nJsonPatch[] = [
      { key: "greeting", lang: "de", value: "Hallo" },
    ];
    const result = applyI18nJsonPatches(tempDir, patches);

    expect(result.applied).toBe(1);
    const filePath = path.join(tempDir, "locales", "de.json");
    expect(fs.existsSync(filePath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(content["greeting"]).toBe("Hallo");
  });

  it("Use existing src/locales directory", () => {
    fs.mkdirSync(path.join(tempDir, "src", "locales"), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, "src", "locales", "en.json"),
      JSON.stringify({ existing: "value" }, null, 2)
    );

    const patches: I18nJsonPatch[] = [
      { key: "new.key", lang: "en", value: "New Value" },
    ];
    const result = applyI18nJsonPatches(tempDir, patches);

    expect(result.applied).toBe(1);
    const content = JSON.parse(
      fs.readFileSync(path.join(tempDir, "src", "locales", "en.json"), "utf-8")
    );
    expect(content["existing"]).toBe("value");
    expect(content["new.key"]).toBe("New Value");
  });

  it("Skip unchanged values", () => {
    fs.mkdirSync(path.join(tempDir, "locales"));
    fs.writeFileSync(
      path.join(tempDir, "locales", "en.json"),
      JSON.stringify({ title: "Same Value" }, null, 2)
    );

    const patches: I18nJsonPatch[] = [
      { key: "title", lang: "en", value: "Same Value" },
    ];
    const result = applyI18nJsonPatches(tempDir, patches);

    expect(result.applied).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("Multiple languages in one call", () => {
    fs.mkdirSync(path.join(tempDir, "locales"));
    fs.writeFileSync(
      path.join(tempDir, "locales", "en.json"),
      JSON.stringify({}, null, 2)
    );

    const patches: I18nJsonPatch[] = [
      { key: "greeting", lang: "en", value: "Hello" },
      { key: "greeting", lang: "de", value: "Hallo" },
      { key: "greeting", lang: "fr", value: "Bonjour" },
    ];
    const result = applyI18nJsonPatches(tempDir, patches);

    expect(result.applied).toBe(3);
    expect(fs.existsSync(path.join(tempDir, "locales", "en.json"))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, "locales", "de.json"))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, "locales", "fr.json"))).toBe(true);

    const en = JSON.parse(
      fs.readFileSync(path.join(tempDir, "locales", "en.json"), "utf-8")
    );
    const de = JSON.parse(
      fs.readFileSync(path.join(tempDir, "locales", "de.json"), "utf-8")
    );
    const fr = JSON.parse(
      fs.readFileSync(path.join(tempDir, "locales", "fr.json"), "utf-8")
    );

    expect(en["greeting"]).toBe("Hello");
    expect(de["greeting"]).toBe("Hallo");
    expect(fr["greeting"]).toBe("Bonjour");
  });
});
