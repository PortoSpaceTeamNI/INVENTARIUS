import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, MapPin, Plus, Search } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, get, type Location } from "../api";
import { LocationSelect } from "../components/pickers";
import { Card, Empty, ErrorBox, Loading, Page, Sheet } from "../components/ui";
import { useT } from "../i18n";
import { useLocations } from "../lib";

interface Count {
  id: number;
  stock_count: number;
  asset_count: number;
}

/** Things directly in each place, and in each place including everything inside it. */
export function useLocationCounts(locs: Location[] | undefined) {
  const counts = useQuery({
    queryKey: ["location-counts"],
    queryFn: () => get<Count[]>("/api/locations/counts"),
  });
  return useMemo(() => {
    const direct = new Map((counts.data ?? []).map((c) => [c.id, c.stock_count + c.asset_count]));
    const kids = new Map<number | null, Location[]>();
    for (const l of locs ?? []) kids.set(l.parent_id, [...(kids.get(l.parent_id) ?? []), l]);
    const total = new Map<number, number>();
    const sum = (id: number, depth = 0): number => {
      const known = total.get(id);
      if (known !== undefined) return known;
      let n = direct.get(id) ?? 0;
      if (depth < 32) for (const k of kids.get(id) ?? []) n += sum(k.id, depth + 1);
      total.set(id, n);
      return n;
    };
    for (const l of locs ?? []) sum(l.id);
    return { total, kids };
  }, [counts.data, locs]);
}

const byName = (a: Location, b: Location) => a.name.localeCompare(b.name, undefined, { numeric: true });

export function LocationsPage() {
  const { data: locs, isPending, error } = useLocations();
  const { total, kids } = useLocationCounts(locs);
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<Set<number> | null>(null);
  const t = useT();

  // Places matching the filter, plus their ancestors so they stay visible.
  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f || !locs) return null;
    const byId = new Map(locs.map((l) => [l.id, l]));
    const keep = new Set<number>();
    for (const l of locs)
      if (l.name.toLowerCase().includes(f))
        for (
          let p: Location | undefined = l, d = 0;
          p && d < 32;
          p = p.parent_id ? byId.get(p.parent_id) : undefined, d++
        )
          keep.add(p.id);
    return keep;
  }, [filter, locs]);

  // Top-level places start open.
  const roots = (kids.get(null) ?? []).sort(byName);
  const expanded = open ?? new Set(roots.map((r) => r.id));
  const toggle = (id: number) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpen(next);
  };

  return (
    <Page
      title={t.locs.title}
      subtitle={locs && t.locs.subtitle(locs.length, roots.length)}
      actions={
        <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
          <Plus size={16} /> {t.locs.newPlace}
        </button>
      }
    >
      <ErrorBox error={error} />
      <div className="toolbar">
        <div className="search-input">
          <Search size={16} />
          <input
            type="search"
            placeholder={t.locs.find}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <button type="button" className="btn" onClick={() => setOpen(new Set(locs?.map((l) => l.id)))}>
          <ChevronsUpDown size={15} /> {t.locs.expandAll}
        </button>
        <button type="button" className="btn" onClick={() => setOpen(new Set())}>
          <ChevronsDownUp size={15} /> {t.locs.collapse}
        </button>
      </div>
      {isPending ? (
        <Loading rows={6} />
      ) : roots.length === 0 ? (
        <Card>
          <Empty
            icon={<MapPin size={20} />}
            title={t.locs.noneYet}
            action={
              <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
                <Plus size={15} /> {t.locs.addRoom}
              </button>
            }
          >
            {t.locs.noneHint}
          </Empty>
        </Card>
      ) : (
        <Card>
          <ul className="tree">
            {roots
              .filter((l) => !visible || visible.has(l.id))
              .map((l) => (
                <TreeNode
                  key={l.id}
                  loc={l}
                  kids={kids}
                  total={total}
                  isOpen={(id) => (visible ? visible.has(id) : expanded.has(id))}
                  visible={visible}
                  toggle={toggle}
                  depth={0}
                />
              ))}
          </ul>
        </Card>
      )}
      <NewLocationSheet open={adding} onClose={() => setAdding(false)} />
    </Page>
  );
}

function TreeNode(props: {
  loc: Location;
  kids: Map<number | null, Location[]>;
  total: Map<number, number>;
  isOpen: (id: number) => boolean;
  visible: Set<number> | null;
  toggle: (id: number) => void;
  depth: number;
}) {
  const children = (props.kids.get(props.loc.id) ?? [])
    .filter((k) => !props.visible || props.visible.has(k.id))
    .sort(byName);
  const open = props.isOpen(props.loc.id);
  const n = props.total.get(props.loc.id) ?? 0;
  const t = useT();
  return (
    <li>
      <div className="tree-row">
        <button
          type="button"
          className={`tree-toggle ${open ? "open" : ""} ${children.length ? "" : "leaf"}`}
          onClick={() => props.toggle(props.loc.id)}
          aria-label={open ? t.locs.collapse : t.locs.expand}
          aria-expanded={open}
        >
          <ChevronRight size={16} />
        </button>
        <Link to={`/locations/${props.loc.id}`}>
          <MapPin size={15} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {props.loc.name}
          </span>
        </Link>
        <span className="tree-meta">
          {children.length > 0 && t.locs.nInside(children.length)}
          {t.common.things(n)}
        </span>
      </div>
      {open && children.length > 0 && props.depth < 20 && (
        <ul>
          {children.map((k) => (
            <TreeNode key={k.id} {...props} loc={k} depth={props.depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function NewLocationSheet(props: { open: boolean; onClose: () => void; parentId?: number }) {
  const [name, setName] = useState("");
  const [parent, setParent] = useState<number | null>(props.parentId ?? null);
  const [print, setPrint] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const t = useT();

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const loc = await api<Location>("POST", "/api/locations", {
        name,
        parent_id: parent,
        print_label: print,
      });
      await qc.invalidateQueries({ queryKey: ["locations"] });
      qc.invalidateQueries({ queryKey: ["location"] });
      qc.invalidateQueries({ queryKey: ["location-counts"] });
      setName("");
      props.onClose();
      if (props.parentId === undefined) navigate(`/locations/${loc.id}`);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Sheet open={props.open} onClose={props.onClose} title={t.locs.newPlace} subtitle={t.locs.newSubtitle}>
      <form onSubmit={submit} className="form">
        <label className="field">
          <span>{t.common.name}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t.locs.namePh}
            required
            autoFocus
          />
        </label>
        <label className="field">
          <span>{t.common.inside}</span>
          <LocationSelect value={parent} onChange={setParent} emptyLabel={t.common.nothingRoom} />
        </label>
        <label className="check">
          <input type="checkbox" checked={print} onChange={(e) => setPrint(e.target.checked)} />
          {t.locs.printLabel}
        </label>
        <ErrorBox error={error} />
        <button type="submit" className="btn btn-primary btn-lg btn-block">
          {t.locs.create}
        </button>
      </form>
    </Sheet>
  );
}
