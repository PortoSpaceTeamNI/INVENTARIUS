// Room map helpers: which shapes stand for which places, and geometry for the editor.
import { useQuery } from "@tanstack/react-query";
import { get, type ItemDetail, type Location, type MapShape, type RoomMap, type ShapeKind } from "./api";

export const useMaps = () => useQuery({ queryKey: ["maps"], queryFn: () => get<RoomMap[]>("/api/maps") });

export const kindColors: Record<ShapeKind, string> = {
  storage: "#8b5a2b",
  furniture: "#d2a86e",
  fixture: "#94a3b8",
};

export const shapeColor = (s: MapShape) => s.color || kindColors[s.kind];

/** The location and every place above it, nearest first. */
export function lineage(locs: Location[] | undefined, id: number): number[] {
  const byId = new Map((locs ?? []).map((l) => [l.id, l]));
  const out: number[] = [];
  for (let cur: number | null = id; cur != null && out.length < 64 && !out.includes(cur); ) {
    out.push(cur);
    cur = byId.get(cur)?.parent_id ?? null;
  }
  return out;
}

/**
 * The shape that shows where a location is: the one linked to it or, for a
 * drawer inside a linked cabinet, to the nearest place above it.
 */
export function shapeForLocation(
  shapes: MapShape[],
  locs: Location[] | undefined,
  id: number,
): MapShape | undefined {
  for (const l of lineage(locs, id)) {
    const s = shapes.find((x) => x.location_id === l);
    if (s) return s;
  }
  return undefined;
}

/** IDs of the shapes holding any of these locations. */
export function shapesHolding(
  shapes: MapShape[],
  locs: Location[] | undefined,
  ids: Iterable<number>,
): Set<string> {
  const out = new Set<string>();
  for (const id of ids) {
    const s = shapeForLocation(shapes, locs, id);
    if (s) out.add(s.id);
  }
  return out;
}

/** The map showing a location, and the shape it is in (if a map has one). */
export function findOnMaps(
  maps: RoomMap[] | undefined,
  locs: Location[] | undefined,
  id: number,
): { map: RoomMap; shape: MapShape } | undefined {
  for (const map of maps ?? []) {
    const shape = shapeForLocation(map.shapes, locs, id);
    if (shape) return { map, shape };
  }
  return undefined;
}

/** Where an item is kept: its non-empty stock lots and its units. */
export function itemPlaces(d: ItemDetail | undefined): number[] {
  if (!d) return [];
  const ids = new Set<number>();
  for (const s of d.stock) if (s.quantity > 0 || s.count_state === "uncounted") ids.add(s.location_id);
  for (const a of d.assets) if (a.location_id != null && a.status !== "retired") ids.add(a.location_id);
  return [...ids];
}

export const snap = (v: number, step = 5) => Math.round(v / step) * step;

/** Keeps a shape inside the room and at least 5 cm on each side. */
export function clampShape(s: MapShape, width: number, height: number): MapShape {
  const w = Math.min(Math.max(s.w, 5), width);
  const h = Math.min(Math.max(s.h, 5), height);
  return {
    ...s,
    w,
    h,
    x: Math.min(Math.max(s.x, 0), width - w),
    y: Math.min(Math.max(s.y, 0), height - h),
  };
}

export function newShapeId(shapes: MapShape[]): string {
  let n = shapes.length + 1;
  while (shapes.some((s) => s.id === `s${n}`)) n++;
  return `s${n}`;
}
