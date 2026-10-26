import { describe, expect, it } from "vitest";
import type { Location, MapShape } from "./api";
import { clampShape, findOnMaps, lineage, newShapeId, shapesHolding } from "./map";

const loc = (id: number, parent_id: number | null): Location => ({
  id,
  parent_id,
  name: `L${id}`,
  description: "",
  created_at: "",
  version: 1,
});
const shape = (id: string, location_id: number | null, x = 0): MapShape => ({
  id,
  label: id,
  kind: "storage",
  color: "",
  x,
  y: 0,
  w: 50,
  h: 50,
  location_id,
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
