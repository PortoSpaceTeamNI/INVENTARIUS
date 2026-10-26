import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Map as MapIcon, Pencil, Plus, Search, X } from "lucide-react";
import { type FormEvent, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  api,
  get,
  type Item,
  type ItemDetail,
  type ItemSummary,
  type LocationDetail,
  type MapShape,
  type RoomMap,
} from "../api";
import { AddSheet } from "../components/AddStock";
import { LocationSelect } from "../components/pickers";
import { RoomCanvas } from "../components/RoomCanvas";
import { Card, Empty, ErrorBox, ItemIcon, Loading, Page, PlaceIcon, Sheet } from "../components/ui";
import { useT } from "../i18n";
import { itemTitle, locationPaths, stockQty, useAllItems, useLocations } from "../lib";
import { itemPlaces, shapeForLocation, shapesHolding, useMaps } from "../map";
import { useLocationCounts } from "./LocationsPage";

/** Matches an item by name, label text or part number. */
function matches(it: ItemSummary, q: string) {
  const f = q.trim().toLowerCase();
  return !!f && [it.name, it.label_text, it.mpn, it.package].some((v) => v.toLowerCase().includes(f));
}

/**
 * The room map: what is where. ?m= picks the map, ?item= highlights where an
 * item is kept, ?loc= selects the shape holding a place.
 */
export function MapPage() {
  const [params, setParams] = useSearchParams();
  const maps = useMaps();
  const { data: locs } = useLocations();
  const { total } = useLocationCounts(locs);
  const { data: items } = useAllItems();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const t = useT();

  const mapId = Number(params.get("m")) || maps.data?.[0]?.id;
  const map = maps.data?.find((m) => m.id === mapId) ?? maps.data?.[0];
  const itemId = Number(params.get("item")) || null;
  const locParam = Number(params.get("loc")) || null;

  const item = useQuery({
    queryKey: ["item", itemId],
    queryFn: () => get<ItemDetail>(`/api/items/${itemId}`),
    enabled: itemId != null,
  });
  const places = useMemo(() => itemPlaces(item.data), [item.data]);

  const highlighted = useMemo(
    () => (map && itemId ? shapesHolding(map.shapes, locs, places) : new Set<string>()),
    [map, itemId, locs, places],
  );
  const counts = useMemo(
    () =>
      new Map((map?.shapes ?? []).map((s) => [s.id, s.location_id ? (total.get(s.location_id) ?? 0) : 0])),
    [map, total],
  );
  // A place asked for in the URL selects its shape, until something is tapped.
  const selectedId =
    picked ?? (map && locParam ? (shapeForLocation(map.shapes, locs, locParam)?.id ?? null) : null);
  const selected = map?.shapes.find((s) => s.id === selectedId) ?? null;

  const suggestions = useMemo(
    () => (query.trim() ? (items ?? []).filter((it) => matches(it, query)).slice(0, 8) : []),
    [items, query],
  );

  function setParam(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v == null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  }

  if (maps.isPending) return <Loading />;
  if (maps.error) return <ErrorBox error={maps.error} />;

  // Other maps where the highlighted item is too.
  const elsewhere = itemId
    ? (maps.data ?? []).filter((m) => m.id !== map?.id && shapesHolding(m.shapes, locs, places).size > 0)
    : [];
  const itemName = item.data ? itemTitle(item.data.item) : "";

  return (
    <Page
      title={t.map.title}
      subtitle={t.map.subtitle}
      actions={
        <>
          {map && (
            <Link to={`/map/${map.id}/edit`} className="btn">
              <Pencil size={15} /> {t.map.editLayout}
            </Link>
          )}
          <button type="button" className="btn" onClick={() => setCreating(true)}>
            <Plus size={16} /> {t.map.newMap}
          </button>
        </>
      }
    >
      {!map ? (
        <Card>
          <Empty
            icon={<MapIcon size={20} />}
            title={t.map.noMaps}
            action={
              <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
                <Plus size={15} /> {t.map.newMap}
              </button>
            }
          >
            {t.map.noMapsHint}
          </Empty>
        </Card>
      ) : (
        <>
          <div className="toolbar">
            {(maps.data?.length ?? 0) > 1 && (
              <div className="chips">
                {maps.data?.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={`chip ${m.id === map.id ? "on" : ""}`}
                    onClick={() => {
                      setPicked(null);
                      setParam({ m: String(m.id), loc: null });
                    }}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            )}
            <div className="search-input map-search">
              <Search size={16} />
              <input
                type="search"
                placeholder={t.map.findItem}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && suggestions[0]) {
                    setParam({ item: String(suggestions[0].id) });
                    setQuery("");
                  }
                }}
              />
              {query.trim() && (
                <div className="map-suggest card" role="listbox">
                  {suggestions.length === 0 ? (
                    <div className="map-suggest-empty muted">{t.map.noMatches}</div>
                  ) : (
                    suggestions.map((it) => (
                      <button
                        key={it.id}
                        type="button"
                        role="option"
                        aria-selected={false}
                        className="map-suggest-row"
                        onClick={() => {
                          setParam({ item: String(it.id) });
                          setQuery("");
                        }}
                      >
                        <ItemIcon kind={it.kind} photo={it.photo} size={14} />
                        <span>{itemTitle(it)}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          {itemId && item.data && (
            <div className={`alert ${highlighted.size ? "alert-info" : "alert-warn"} map-finding`}>
              <span>
                <strong>{t.map.showing(itemName)}</strong>
                {" · "}
                {highlighted.size
                  ? t.map.spots(highlighted.size)
                  : elsewhere.length
                    ? t.map.notHere
                    : t.map.notPlaced}
                {elsewhere.length > 0 && (
                  <>
                    {" · "}
                    {t.map.alsoOn}{" "}
                    {elsewhere.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        className="link-btn"
                        onClick={() => setParam({ m: String(m.id) })}
                      >
                        {m.name}
                      </button>
                    ))}
                  </>
                )}
              </span>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setParam({ item: null })}
                aria-label={t.map.clear}
              >
                <X size={14} /> {t.map.clear}
              </button>
            </div>
          )}
          <ErrorBox error={item.error} />

          <div className="layout-2 map-layout">
            <Card className="map-card">
              <div className="map-scroll">
                <RoomCanvas
                  label={map.name}
                  width={map.width}
                  height={map.height}
                  shapes={map.shapes}
                  selected={selectedId}
                  highlighted={highlighted}
                  counts={counts}
                  onSelect={(s) => {
                    setPicked(s.id);
                    // On phones the panel is under the map: bring it into view.
                    requestAnimationFrame(() =>
                      panel.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
                    );
                  }}
                  onBackground={() => setPicked("")}
                />
              </div>
            </Card>
            <div ref={panel}>
              <ShapePanel shape={selected} map={map} highlightItem={itemId} />
            </div>
          </div>
        </>
      )}
      {creating && <NewMapSheet onClose={() => setCreating(false)} />}
    </Page>
  );
}

/** What is in the tapped shape's place, with ways to add to it. */
function ShapePanel(props: { shape: MapShape | null; map: RoomMap; highlightItem: number | null }) {
  const { shape } = props;
  const locId = shape?.location_id ?? null;
  const detail = useQuery({
    queryKey: ["location", locId],
    queryFn: () => get<LocationDetail>(`/api/locations/${locId}`),
    enabled: locId != null,
  });
  const { data: locs } = useLocations();
  const { total } = useLocationCounts(locs);
  const paths = useMemo(() => locationPaths(locs), [locs]);
  const [adding, setAdding] = useState(false);
  const t = useT();

  if (!shape)
    return (
      <Card>
        <Empty icon={<MapIcon size={20} />}>{t.map.pickShape}</Empty>
      </Card>
    );
  if (locId == null)
    return (
      <Card title={shape.label}>
        <Empty
          icon={<MapIcon size={20} />}
          title={t.map.notLinked}
          action={
            <Link to={`/map/${props.map.id}/edit?shape=${shape.id}`} className="btn">
              <Pencil size={15} /> {t.map.editLayout}
            </Link>
          }
        >
          {t.map.linkInEditor}
        </Empty>
      </Card>
    );

  const d = detail.data;
  const things = d ? d.stock.length + d.assets.length : 0;
  return (
    <Card
      title={shape.label}
      className="map-panel"
      footer={
        <div className="map-panel-actions">
          <button type="button" className="btn btn-primary btn-block" onClick={() => setAdding(true)}>
            <Plus size={15} /> {t.map.addStock}
          </button>
          <div className="grid-2">
            <Link to={`/items/new?location=${locId}`} className="btn btn-block">
              <Plus size={15} /> {t.map.newItemHere}
            </Link>
            <Link to={`/locations/${locId}`} className="btn btn-block">
              <ArrowRight size={15} /> {t.map.openPlace}
            </Link>
          </div>
        </div>
      }
    >
      <div className="card-pad muted map-panel-path">{paths.get(locId)}</div>
      {detail.isPending ? (
        <div className="card-pad">
          <Loading rows={2} />
        </div>
      ) : detail.error ? (
        <div className="card-pad">
          <ErrorBox error={detail.error} />
        </div>
      ) : (
        d && (
          <div className="list">
            {d.children.map((c) => (
              <Link key={c.id} to={`/locations/${c.id}`} className="list-row">
                <PlaceIcon size={15} />
                <div className="row-main">
                  <div className="row-title">{c.name}</div>
                  <div className="row-meta">{t.common.things(total.get(c.id) ?? 0)}</div>
                </div>
              </Link>
            ))}
            {d.stock.map((s) => (
              <Link
                key={`s${s.stock.id}`}
                to={`/stock/${s.stock.id}`}
                className={`list-row ${s.stock.item_id === props.highlightItem ? "map-row-hit" : ""}`}
              >
                <ItemIcon kind={s.item_kind} size={15} />
                <div className="row-main">
                  <div className="row-title">{itemTitle({ name: s.item_name, package: s.item_package })}</div>
                </div>
                <span className="qty">{stockQty(s.stock, s.item_unit)}</span>
              </Link>
            ))}
            {d.assets.map((a) => (
              <Link
                key={`a${a.asset.id}`}
                to={`/assets/${a.asset.id}`}
                className={`list-row ${a.asset.item_id === props.highlightItem ? "map-row-hit" : ""}`}
              >
                <ItemIcon kind={a.item_kind} size={15} />
                <div className="row-main">
                  <div className="row-title">{a.item_name}</div>
                  <div className="row-meta mono">A{a.asset.id}</div>
                </div>
              </Link>
            ))}
            {d.children.length === 0 && things === 0 && (
              <div className="card-pad muted">{t.map.nothingHere}</div>
            )}
          </div>
        )
      )}
      {adding && <PickItemSheet location={locId} onClose={() => setAdding(false)} />}
    </Card>
  );
}

/** Choose an item, then add stock or units of it to a place. */
function PickItemSheet(props: { location: number; onClose: () => void }) {
  const { data: items } = useAllItems();
  const [query, setQuery] = useState("");
  const [item, setItem] = useState<Item | null>(null);
  const t = useT();
  const list = useMemo(() => {
    const all = items ?? [];
    return (query.trim() ? all.filter((it) => matches(it, query)) : all).slice(0, 30);
  }, [items, query]);

  if (item)
    return <AddSheet open onClose={props.onClose} item={item} initial={{ location: props.location }} />;
  return (
    <Sheet open onClose={props.onClose} title={t.map.pickItem} subtitle={t.map.pickItemHint}>
      <div className="form">
        <div className="search-input map-pick-search">
          <Search size={16} />
          <input
            type="search"
            placeholder={t.map.searchItems}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>
        <div className="list map-pick-list">
          {list.map((it) => (
            <button key={it.id} type="button" className="list-row map-pick-row" onClick={() => setItem(it)}>
              <ItemIcon kind={it.kind} photo={it.photo} size={15} />
              <div className="row-main">
                <div className="row-title">{itemTitle(it)}</div>
                <div className="row-meta mono">I{it.id}</div>
              </div>
            </button>
          ))}
          {list.length === 0 && <div className="card-pad muted">{t.map.noMatches}</div>}
        </div>
      </div>
    </Sheet>
  );
}

function NewMapSheet(props: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [room, setRoom] = useState<number | null>(null);
  const [width, setWidth] = useState("6");
  const [height, setHeight] = useState("4");
  const [error, setError] = useState<unknown>(null);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const t = useT();

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const m = await api<RoomMap>("POST", "/api/maps", {
        name,
        location_id: room,
        width: Math.round(Number(width.replace(",", ".")) * 100),
        height: Math.round(Number(height.replace(",", ".")) * 100),
        shapes: [],
      });
      qc.invalidateQueries({ queryKey: ["maps"] });
      navigate(`/map/${m.id}/edit`);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Sheet open onClose={props.onClose} title={t.map.newMap}>
      <form onSubmit={submit} className="form">
        <label className="field">
          <span>{t.common.name}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="field">
          <span>{t.map.roomPlace}</span>
          <LocationSelect value={room} onChange={setRoom} emptyLabel={t.map.noRoomPlace} />
        </label>
        <div className="grid-2">
          <label className="field">
            <span>{t.map.roomWidth}</span>
            <input inputMode="decimal" value={width} onChange={(e) => setWidth(e.target.value)} required />
          </label>
          <label className="field">
            <span>{t.map.roomHeight}</span>
            <input inputMode="decimal" value={height} onChange={(e) => setHeight(e.target.value)} required />
          </label>
        </div>
        <ErrorBox error={error} />
        <button type="submit" className="btn btn-primary btn-lg btn-block">
          {t.map.newMap}
        </button>
      </form>
    </Sheet>
  );
}
