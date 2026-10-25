import { describe, expect, it } from "vitest";
import { fr } from "../locales/fr";
import { zh } from "../locales/zh";

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((match) => match[1]!).sort();
}

describe("complétude du dictionnaire français", () => {
  it("couvre toutes les clés sans repli chinois et conserve les paramètres", () => {
    const missing: string[] = [];
    const cjk: string[] = [];
    const wrongParams: string[] = [];
    for (const [namespace, values] of Object.entries(zh)) {
      for (const [key, source] of Object.entries(values)) {
        const id = `${namespace}.${key}`;
        const translated = (fr as Record<string, Record<string, string>>)[namespace]?.[key];
        if (translated === undefined) missing.push(id);
        else {
          if (/[㐀-鿿]/.test(translated)) cjk.push(id);
          if (placeholders(translated).join(",") !== placeholders(source).join(",")) wrongParams.push(id);
        }
      }
    }
    expect(missing).toEqual([]);
    expect(cjk).toEqual([]);
    expect(wrongParams).toEqual([]);
  });
});
