import { describe, expect, it } from "vitest";
import type { ItemDetail, Location, MapShape } from "./api";
import { clampShape, findOnMaps, lineage, newShapeId, parseLink, shapesForItem, shapesHolding } from "./map";

const loc = (id: number, parent_id: number | null): Location => ({
  id,
  parent_id,
  name: `L${id}`,
  description: "",
  created_at: "",
  version: 1,
});
const shape = (
  id: string,
  location: number | null,
  x = 0,
  link = location ? `L${location}` : "",
): MapShape => ({
  id,
  label: id,
  kind: "storage",
  color: "",
  x,
  y: 0,
  w: 50,
  h: 50,
  link,
});

// Room 1 › Cabinet 2 › Drawer 3; Room 1 › Table 4
const locs = [loc(1, null), loc(2, 1), loc(3, 2), loc(4, 1)];

describe("room map", () => {
  it("walks up the location tree", () => {
    expect(lineage(locs, 3)).toEqual([3, 2, 1]);
  });

  it("finds the shape holding a place, or the nearest place above it", () => {
    const shapes = [shape("cab", 2), shape("table", 4)];
    expect([...shapesHolding(shapes, locs, [3])]).toEqual(["cab"]);
    expect([...shapesHolding(shapes, locs, [4, 2])].sort()).toEqual(["cab", "table"]);
    // The room itself has no shape.
    expect(shapesHolding(shapes, locs, [1]).size).toBe(0);
  });

  it("finds which map shows a place", () => {
    const map = { id: 7, name: "Sala", location_id: 1, width: 500, height: 300, version: 1, updated_at: "" };
    const found = findOnMaps([{ ...map, shapes: [shape("cab", 2)] }], locs, 3);
    expect(found?.map.id).toBe(7);
    expect(found?.shape.id).toBe("cab");
    expect(findOnMaps([{ ...map, shapes: [] }], locs, 3)).toBeUndefined();
  });

  it("reads links", () => {
    expect(parseLink("i5")).toEqual({ kind: "I", id: 5 });
    expect(parseLink("C12")).toEqual({ kind: "C", id: 12 });
    expect(parseLink("")).toBeNull();
    expect(parseLink("X1")).toBeNull();
    expect(parseLink("L0")).toBeNull();
  });

  it("finds an item through its places, lots, units and category", () => {
    const cats = [
      { id: 1, parent_id: null, name: "Tools", version: 1 },
      { id: 2, parent_id: 1, name: "Scopes", version: 1 },
    ];
    const shapes = [
      shape("drawer", 3),
      shape("item", null, 0, "I9"),
      shape("lot", null, 0, "S40"),
      shape("unit", null, 0, "A7"),
      shape("cat", null, 0, "C1"),
      shape("other", null, 0, "I10"),
    ];
    const d = {
      item: { id: 9, category_id: 2 },
      stock: [{ id: 40, location_id: 2, quantity: 3, count_state: "exact" }],
      assets: [{ id: 7, location_id: null, status: "available" }],
    } as unknown as ItemDetail;
    expect([...shapesForItem(shapes, locs, cats, d)].sort()).toEqual(["cat", "item", "lot", "unit"]);
    // The lot sits in cabinet 2, which no shape holds; drawer 3 is below it.
    expect(shapesForItem(shapes, locs, cats, undefined).size).toBe(0);
  });

  it("keeps shapes inside the room", () => {
    const s = clampShape({ ...shape("a", null, 480), w: 60 }, 500, 300);
    expect(s.x + s.w).toBe(500);
    expect(clampShape({ ...shape("a", null), w: 1, h: 900 }, 500, 300)).toMatchObject({ w: 5, h: 300, y: 0 });
  });

  it("makes unused shape ids", () => {
    expect(newShapeId([shape("s2", null)])).toBe("s3");
    expect(newShapeId([shape("s2", null), shape("s3", null)])).toBe("s4");
  });
});
