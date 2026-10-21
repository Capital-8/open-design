import { describe, expect, test } from "vitest";
import { parseSource, withNativeSourceParser } from "../../../scripts/lib/typescript/source.ts";
import { collectRelativeSpecifiers } from "../../../scripts/check-ts-nocheck-imports.ts";

describe("native guard parser", () => {
  test("a shared session invalidates changed source and switches TS/TSX syntax", async () => {
    await withNativeSourceParser(async () => {
      expect(collectRelativeSpecifiers("input.ts", 'const x = <string>value; import "./first.js";')).toEqual([
        { specifier: "./first.js", lineNumber: 1 },
      ]);
      expect(collectRelativeSpecifiers("input.ts", 'import "./second.js";')).toEqual([
        { specifier: "./second.js", lineNumber: 1 },
      ]);
      expect(collectRelativeSpecifiers("input.tsx", 'const view = <div>🌸</div>;\nimport "./third.js";')).toEqual([
        { specifier: "./third.js", lineNumber: 2 },
      ]);
      const oldTree = parseSource("input.ts", "const oldValue = 1;");
      parseSource("input.ts", "const newValue = 2;");
      expect(oldTree.statements[0]?.getText(oldTree)).toBe("const oldValue = 1;");
    });
  });

  test("releases a failed session before the next parse", async () => {
    await expect(withNativeSourceParser(async () => {
      parseSource("input.ts", "const before = 1;");
      throw new Error("probe failure");
    })).rejects.toThrow("probe failure");
    const tree = parseSource("input.ts", "const after = 2;");
    expect(tree.statements[0]?.getText(tree)).toBe("const after = 2;");
  });
});
