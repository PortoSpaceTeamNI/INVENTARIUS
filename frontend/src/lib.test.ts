import { describe, expect, it } from "vitest";
import type { Location, Meta } from "./api";
import { forLabel, locationPaths, qty } from "./lib";
import { expandCodes } from "./pages/PrintPage";

const loc = (id: number, name: string, parent_id: number | null = null): Location => ({
  id,
  name,
  parent_id,
  description: "",
  created_at: "",
  version: 1,
});

describe("expandCodes", () => {
  it("expands ranges and normalizes case", () => {
    expect(expandCodes("l4-l6, a9;S2")).toEqual(["L4", "L5", "L6", "A9", "S2"]);
    expect(expandCodes("L7-9")).toEqual(["L7", "L8", "L9"]);
  });
  it("rejects bad input", () => {
    expect(() => expandCodes("X1")).toThrow();
    expect(() => expandCodes("L9-L3")).toThrow();
    expect(() => expandCodes("L1-L500")).toThrow();
    expect(() => expandCodes("L0")).toThrow();
    expect(() => expandCodes("  ")).toThrow();
  });
});

describe("locationPaths", () => {
  it("joins ancestors", () => {
    const p = locationPaths([loc(3, "Bin 3", 2), loc(1, "Room"), loc(2, "Shelf A", 1)]);
    expect(p.get(3)).toBe("Room › Shelf A › Bin 3");
    expect(p.get(1)).toBe("Room");
  });
  it("survives a parent cycle", () => {
    const p = locationPaths([loc(1, "A", 2), loc(2, "B", 1)]);
    expect(p.get(1)).toContain("A");
  });
});

describe("formatting", () => {
  it("formats quantities", () => {
    expect(qty(3)).toBe("3");
    expect(qty(0.1 + 0.2, "m")).toBe("0.3 m");
    expect(qty(12, "pcs")).toBe("12");
  });
  it("names purposes", () => {
    const meta: Meta = {
      projects: [{ id: 1, code: "INVICTUS", name: "INVICTUS" }],
      departments: [{ id: 4, project_id: 1, name: "Propulsion" }],
      symbology: "datamatrix",
      label_url: "",
    };
    expect(forLabel(meta, null, 4)).toBe("INVICTUS · Propulsion");
    expect(forLabel(meta, 1, null)).toBe("INVICTUS");
    expect(forLabel(meta, null, null)).toBe("");
  });
});
