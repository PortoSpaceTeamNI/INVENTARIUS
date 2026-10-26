import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, MapPin, MoreHorizontal, Plus, Save, Trash2 } from "lucide-react";
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, get, type Location, type MapShape, type RoomMap, type ShapeKind } from "../api";
import { LocationSelect } from "../components/pickers";
import { RoomCanvas } from "../components/RoomCanvas";
import { Card, ErrorBox, Loading, Menu, Page, useToast } from "../components/ui";
import { useT } from "../i18n";
import { errorMessage, useMe } from "../lib";
import { clampShape, kindColors, newShapeId, shapeColor, snap } from "../map";

const kinds: ShapeKind[] = ["storage", "furniture", "fixture"];

type Drag = {
  id: string;
  part: "body" | "handle";
  start: { x: number; y: number };
  shape: MapShape;
};

/** Pointer position in the map's centimetres. */
function toMap(svg: SVGSVGElement, e: { clientX: number; clientY: number }) {
  const m = svg.getScreenCTM();
  if (!m) return { x: 0, y: 0 };
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
  return { x: p.x, y: p.y };
}

/** Editor for a room map: move, resize, add and remove shapes and link them to places. */
export function MapEditPage() {
  const id = Number(useParams().id);
  const q = useQuery({ queryKey: ["map", id], queryFn: () => get<RoomMap>(`/api/maps/${id}`) });
  if (q.isPending) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  return <Editor key={q.data.id} initial={q.data} />;
}

function Editor(props: { initial: RoomMap }) {
  const [map, setMap] = useState<RoomMap>(props.initial);
  const [params] = useSearchParams();
  const [selected, setSelected] = useState<string | null>(params.get("shape"));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const { data: me } = useMe();
  const t = useT();

  const shape = map.shapes.find((s) => s.id === selected) ?? null;

  function change(next: RoomMap) {
    setMap(next);
    setDirty(true);
  }
  function updateShape(sid: string, patch: Partial<MapShape>) {
    change({
      ...map,
      shapes: map.shapes.map((s) =>
        s.id === sid ? clampShape({ ...s, ...patch }, map.width, map.height) : s,
      ),
    });
  }
  function addShape(kind: ShapeKind, from?: MapShape) {
    const base: MapShape = from
      ? { ...from, x: from.x + 20, y: from.y + 20, location_id: null }
      : {
          id: "",
          label: t.map.newLabel[kind],
          kind,
          color: "",
          x: snap(map.width / 2 - 40),
          y: snap(map.height / 2 - 30),
          w: 80,
          h: kind === "fixture" ? 10 : 60,
          location_id: null,
        };
    const s = clampShape({ ...base, id: newShapeId(map.shapes) }, map.width, map.height);
    change({ ...map, shapes: [...map.shapes, s] });
    setSelected(s.id);
  }
  function removeShape(sid: string) {
    change({ ...map, shapes: map.shapes.filter((s) => s.id !== sid) });
    setSelected(null);
  }

  // Warn before leaving the page with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // Arrow keys nudge the selected shape (Shift: 25 cm); Delete removes it.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement;
      if (!shape || el.closest("input, select, textarea, dialog")) return;
      const step = e.shiftKey ? 25 : 5;
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      if (moves[e.key]) {
        e.preventDefault();
        const [dx, dy] = moves[e.key];
        updateShape(shape.id, { x: shape.x + dx, y: shape.y + dy });
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeShape(shape.id);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function onPointerDown(e: ReactPointerEvent, s: MapShape, part: "body" | "handle") {
    if (!svg.current || e.button !== 0) return;
    e.preventDefault();
    setSelected(s.id);
    svg.current.setPointerCapture(e.pointerId);
    drag.current = { id: s.id, part, start: toMap(svg.current, e), shape: s };
  }
  function onPointerMove(e: ReactPointerEvent) {
    const d = drag.current;
    if (!d || !svg.current) return;
    const p = toMap(svg.current, e);
    const dx = p.x - d.start.x;
    const dy = p.y - d.start.y;
    const patch =
      d.part === "body"
        ? { x: snap(d.shape.x + dx), y: snap(d.shape.y + dy) }
        : { w: snap(d.shape.w + dx), h: snap(d.shape.h + dy) };
    // Clamp against the room, without letting a resize push the shape.
    const next = clampShape({ ...d.shape, ...patch }, map.width, map.height);
    if (d.part === "handle") {
      next.x = d.shape.x;
      next.y = d.shape.y;
      next.w = Math.min(next.w, map.width - d.shape.x);
      next.h = Math.min(next.h, map.height - d.shape.y);
    }
    const cur = map.shapes.find((s) => s.id === d.id);
    if (cur && cur.x === next.x && cur.y === next.y && cur.w === next.w && cur.h === next.h) return;
    change({ ...map, shapes: map.shapes.map((s) => (s.id === d.id ? next : s)) });
  }
  function onPointerUp() {
    drag.current = null;
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const saved = await api<RoomMap>("PUT", `/api/maps/${map.id}`, map);
      setMap(saved);
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["maps"] });
      qc.setQueryData(["map", saved.id], saved);
      toast(t.map.saved);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function deleteMap() {
    if (!confirm(t.map.confirmDelete(map.name))) return;
    try {
      await api("DELETE", `/api/maps/${map.id}`);
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["maps"] });
      toast(t.map.deleted(map.name));
      navigate("/map", { replace: true });
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  /** Creates a location named after the shape (or the room) and links it. */
  async function createPlace(target: "shape" | "room") {
    setError(null);
    try {
      const loc = await api<Location>("POST", "/api/locations", {
        name: target === "shape" ? shape?.label : map.name,
        parent_id: target === "shape" ? map.location_id : null,
      });
      qc.invalidateQueries({ queryKey: ["locations"] });
      if (target === "shape" && shape) updateShape(shape.id, { location_id: loc.id });
      else change({ ...map, location_id: loc.id });
      toast(t.map.placeCreated(loc.name));
    } catch (err) {
      setError(err);
    }
  }

  const num = (v: string) => Number(v.replace(",", "."));
  const metres = (cm: number) => String(cm / 100);

  return (
    <Page
      crumbs={[{ label: t.map.title, to: `/map?m=${map.id}` }]}
      title={t.map.editTitle(map.name)}
      subtitle={dirty ? <span className="text-warn">{t.map.unsaved}</span> : t.map.editHint}
      actions={
        <>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !dirty}>
            <Save size={15} /> {busy ? t.common.saving : t.common.save}
          </button>
          <Link
            to={`/map?m=${map.id}`}
            className="btn"
            onClick={(e) => {
              if (dirty && !confirm(t.map.discard)) e.preventDefault();
            }}
          >
            {t.common.done}
          </Link>
          {me?.role === "admin" && (
            <Menu
              label={t.common.more}
              trigger={<MoreHorizontal size={18} />}
              items={[
                { label: t.map.deleteMap, icon: <Trash2 size={15} />, onSelect: deleteMap, danger: true },
              ]}
            />
          )}
        </>
      }
    >
      <div className="toolbar">
        {kinds.map((k) => (
          <button key={k} type="button" className="btn btn-sm" onClick={() => addShape(k)}>
            <Plus size={14} />
            <span className="map-kind-dot" style={{ background: kindColors[k] }} />
            {t.map.kinds[k]}
          </button>
        ))}
        <span className="muted map-count">{t.map.shapeCount(map.shapes.length)}</span>
      </div>
      <ErrorBox error={error} />
      <div className="layout-2 map-layout">
        <Card className="map-card">
          <div className="map-scroll">
            <RoomCanvas
              svgRef={svg}
              label={t.map.canvas}
              editing
              width={map.width}
              height={map.height}
              shapes={map.shapes}
              selected={selected}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onBackground={() => setSelected(null)}
            />
          </div>
        </Card>

        {shape ? (
          <Card
            title={t.map.shape}
            actions={
              <>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => addShape(shape.kind, shape)}
                  title={t.map.duplicate}
                >
                  <Copy size={14} /> {t.map.duplicate}
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost text-danger"
                  onClick={() => removeShape(shape.id)}
                >
                  <Trash2 size={14} /> {t.map.remove}
                </button>
              </>
            }
          >
            <div className="form card-pad">
              <label className="field">
                <span>{t.common.name}</span>
                <input
                  value={shape.label}
                  maxLength={80}
                  onChange={(e) => updateShape(shape.id, { label: e.target.value })}
                />
              </label>
              <div className="grid-2">
                <label className="field">
                  <span>{t.map.kind}</span>
                  <select
                    value={shape.kind}
                    onChange={(e) => updateShape(shape.id, { kind: e.target.value as ShapeKind })}
                  >
                    {kinds.map((k) => (
                      <option key={k} value={k}>
                        {t.map.kinds[k]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>{t.map.color}</span>
                  <input
                    type="color"
                    className="map-color"
                    value={shapeColor(shape)}
                    onChange={(e) => updateShape(shape.id, { color: e.target.value })}
                  />
                </label>
              </div>
              <label className="field">
                <span>{t.map.place}</span>
                <LocationSelect
                  value={shape.location_id}
                  onChange={(v) => updateShape(shape.id, { location_id: v })}
                  emptyLabel={t.map.notLinkedOption}
                />
              </label>
              {shape.location_id == null &&
                (map.location_id != null ? (
                  <button type="button" className="btn btn-sm" onClick={() => createPlace("shape")}>
                    <MapPin size={14} /> {t.map.createPlace}
                  </button>
                ) : (
                  <div className="field-hint">{t.map.needRoom}</div>
                ))}
              <div className="grid-2">
                {(["x", "y", "w", "h"] as const).map((k) => (
                  <label key={k} className="field">
                    <span>{t.map[k]}</span>
                    <input
                      type="number"
                      step={5}
                      value={shape[k]}
                      onChange={(e) => {
                        const v = num(e.target.value);
                        if (Number.isFinite(v)) updateShape(shape.id, { [k]: v });
                      }}
                    />
                  </label>
                ))}
              </div>
            </div>
          </Card>
        ) : (
          <Card title={t.map.settings}>
            <div className="form card-pad">
              <div className="field-hint">{t.map.selectHint}</div>
              <label className="field">
                <span>{t.common.name}</span>
                <input value={map.name} onChange={(e) => change({ ...map, name: e.target.value })} required />
              </label>
              <label className="field">
                <span>{t.map.roomPlace}</span>
                <LocationSelect
                  value={map.location_id}
                  onChange={(v) => change({ ...map, location_id: v })}
                  emptyLabel={t.map.noRoomPlace}
                />
              </label>
              {map.location_id == null && (
                <button type="button" className="btn btn-sm" onClick={() => createPlace("room")}>
                  <MapPin size={14} /> {t.map.createRoomPlace}
                </button>
              )}
              <div className="grid-2">
                <RoomSize
                  label={t.map.roomWidth}
                  value={metres(map.width)}
                  min={Math.max(...map.shapes.map((s) => s.x + s.w), 1)}
                  onChange={(cm) => change({ ...map, width: cm })}
                />
                <RoomSize
                  label={t.map.roomHeight}
                  value={metres(map.height)}
                  min={Math.max(...map.shapes.map((s) => s.y + s.h), 1)}
                  onChange={(cm) => change({ ...map, height: cm })}
                />
              </div>
            </div>
          </Card>
        )}
      </div>
    </Page>
  );
}

/** Room width or depth typed in metres; never smaller than the shapes in it. */
function RoomSize(props: { label: string; value: string; min: number; onChange: (cm: number) => void }) {
  const [text, setText] = useState(props.value);
  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const cm = Math.round(Number(text.replace(",", ".")) * 100);
          if (Number.isFinite(cm) && cm > 0) {
            const v = Math.max(cm, Math.ceil(props.min));
            props.onChange(v);
            setText(String(v / 100));
          } else setText(props.value);
        }}
      />
    </label>
  );
}
