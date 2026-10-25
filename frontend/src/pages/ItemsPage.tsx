import { useQuery } from "@tanstack/react-query";
import { FileText, Plus, Search, X } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { type Category, get, type ItemKind, type ItemSummary } from "../api";
import { Card, Empty, ErrorBox, ItemIcon, Loading, Page } from "../components/ui";
import { type Dict, useT } from "../i18n";
import {
  isLow,
  isUnitKind,
  itemKinds,
  itemTitle,
  itemTotal,
  kindLabel,
  ownerLabel,
  qty,
  useAllItems,
  useMeta,
} from "../lib";

type Show = "all" | "low" | "reserved" | "uncounted";

const shows = (t: Dict): [Show, string][] => [
  ["all", t.items.showAll],
  ["low", t.items.showLow],
  ["reserved", t.items.showReserved],
  ["uncounted", t.items.showUncounted],
];

export function categoryPaths(cats: Category[] | undefined): Map<number, string> {
  const byId = new Map((cats ?? []).map((c) => [c.id, c]));
  const out = new Map<number, string>();
  const path = (c: Category, d = 0): string => {
    const p = c.parent_id ? byId.get(c.parent_id) : undefined;
    return p && d < 16 ? `${path(p, d + 1)} › ${c.name}` : c.name;
  };
  for (const c of byId.values()) out.set(c.id, path(c));
  return out;
}

export function ItemsPage() {
  const [params, setParams] = useSearchParams();
  const show = (params.get("show") as Show) || "all";
  const kind = (params.get("kind") as ItemKind) || "";
  const category = params.get("category") ? Number(params.get("category")) : null;
  const [q, setQ] = useState(params.get("q") ?? "");
  const query = useDeferredValue(q.trim());
  const [limit, setLimit] = useState(150);
  const navigate = useNavigate();
  const t = useT();
  const { data: meta } = useMeta();
  const items = useAllItems();
  // Text search runs on the server (accents, plurals, "ohm" for Ω), ranked
  // best first; the other filters apply on top of it here.
  const searched = useQuery({
    queryKey: ["items", "search", query],
    queryFn: () => get<ItemSummary[]>(`/api/items?limit=5000&q=${encodeURIComponent(query)}`),
    enabled: query !== "",
    placeholderData: (prev) => prev,
  });
  const base = query ? searched.data : items.data;
  const cats = useQuery({ queryKey: ["categories"], queryFn: () => get<Category[]>("/api/categories") });
  const catPaths = useMemo(() => categoryPaths(cats.data), [cats.data]);

  function set(key: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
    setLimit(150);
  }

  // A category includes its subcategories.
  const inCategory = useMemo(() => {
    if (category === null) return null;
    const ids = new Set([category]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const c of cats.data ?? [])
        if (c.parent_id !== null && ids.has(c.parent_id) && !ids.has(c.id)) {
          ids.add(c.id);
          grew = true;
        }
    }
    return ids;
  }, [category, cats.data]);

  const filtered = useMemo(() => {
    return (base ?? []).filter((it) => {
      if (kind && it.kind !== kind) return false;
      if (inCategory && (it.category_id === null || !inCategory.has(it.category_id))) return false;
      if (show === "low" && !isLow(it)) return false;
      if (show === "reserved" && !(it.reserved_quantity > 0 || it.reserved_assets > 0)) return false;
      if (show === "uncounted" && it.uncounted_lots === 0) return false;
      return true;
    });
  }, [base, kind, inCategory, show]);

  const topCategories = (cats.data ?? [])
    .filter((c) => c.parent_id === null)
    .sort((a, b) => a.name.localeCompare(b.name));
  const subCategories = (cats.data ?? [])
    .filter((c) => category !== null && c.parent_id === category)
    .sort((a, b) => a.name.localeCompare(b.name));
  const parentOfSelected = (cats.data ?? []).find((c) => c.id === category)?.parent_id ?? null;

  return (
    <Page
      title={t.items.title}
      subtitle={items.data && t.items.subtitle(items.data.length)}
      actions={
        <Link to="/items/new" className="btn btn-primary">
          <Plus size={16} /> {t.items.newItem}
        </Link>
      }
    >
      <div className="toolbar">
        <div className="search-input">
          <Search size={16} />
          <input
            type="search"
            placeholder={t.items.filter}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setLimit(150);
            }}
          />
        </div>
        <select value={kind} onChange={(e) => set("kind", e.target.value || null)} aria-label={t.items.kind}>
          <option value="">{t.items.allTypes}</option>
          {itemKinds.map((k) => (
            <option key={k} value={k}>
              {kindLabel(k)}
            </option>
          ))}
        </select>
        <select
          value={category ?? ""}
          onChange={(e) => set("category", e.target.value || null)}
          aria-label={t.common.category}
        >
          <option value="">{t.items.allCategories}</option>
          {[...catPaths.entries()]
            .sort((a, b) => a[1].localeCompare(b[1]))
            .map(([id, p]) => (
              <option key={id} value={id}>
                {p}
              </option>
            ))}
        </select>
      </div>

      <div className="row" style={{ marginBottom: "0.85rem", justifyContent: "space-between" }}>
        <div className="chip-scroll">
          {shows(t).map(([v, label]) => (
            <button
              key={v}
              type="button"
              className={`chip ${show === v ? "on" : ""}`}
              onClick={() => set("show", v === "all" ? null : v)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="small muted">{t.items.count(filtered.length)}</span>
      </div>

      {category === null ? (
        <div className="chip-scroll" style={{ marginBottom: "1rem" }}>
          {topCategories.map((c) => (
            <button key={c.id} type="button" className="chip" onClick={() => set("category", String(c.id))}>
              {c.name}
            </button>
          ))}
        </div>
      ) : (
        <div className="chip-scroll" style={{ marginBottom: "1rem" }}>
          <button
            type="button"
            className="chip on"
            onClick={() => set("category", parentOfSelected ? String(parentOfSelected) : null)}
          >
            {catPaths.get(category)} <X size={12} style={{ verticalAlign: -1 }} />
          </button>
          {subCategories.map((c) => (
            <button key={c.id} type="button" className="chip" onClick={() => set("category", String(c.id))}>
              {c.name}
            </button>
          ))}
        </div>
      )}

      <ErrorBox error={items.error ?? searched.error} />
      {!base ? (
        <Loading rows={8} />
      ) : filtered.length === 0 ? (
        <Card>
          <Empty
            title={items.data?.length ? t.items.noMatch : t.items.noneYet}
            action={
              <Link to="/items/new" className="btn">
                <Plus size={15} /> {t.items.addItem}
              </Link>
            }
          >
            {items.data?.length ? t.items.noMatchHint : t.items.noneHint}
          </Empty>
        </Card>
      ) : (
        <Card>
          <div className="table-wrap only-desktop">
            <table className="table">
              <thead>
                <tr>
                  <th>{t.common.item}</th>
                  <th>{t.common.category}</th>
                  <th>{t.common.owner}</th>
                  <th className="num">{t.items.inStock}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, limit).map((it) => (
                  <tr key={it.id} className="clickable" onClick={() => navigate(`/items/${it.id}`)}>
                    <td>
                      <div className="cell-main">
                        <ItemIcon kind={it.kind} photo={it.photo} size={16} />
                        <div style={{ minWidth: 0 }}>
                          <Link to={`/items/${it.id}`} onClick={(e) => e.stopPropagation()}>
                            {itemTitle(it)}
                          </Link>
                          <div className="row-meta">
                            {it.mpn && !it.name.includes(it.mpn) && <span className="mono">{it.mpn}</span>}
                            {it.datasheet_url && (
                              <span>
                                <FileText size={12} style={{ verticalAlign: -1 }} /> {t.items.datasheet}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="muted small">{it.category_id ? catPaths.get(it.category_id) : "—"}</td>
                    <td className="muted small nowrap">{ownerLabel(meta, it)}</td>
                    <td className="num">
                      <StockCell it={it} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="list only-mobile">
            {filtered.slice(0, limit).map((it) => (
              <Link key={it.id} to={`/items/${it.id}`} className="list-row">
                <ItemIcon kind={it.kind} photo={it.photo} />
                <div className="row-main">
                  <div className="row-title">{itemTitle(it)}</div>
                  <div className="row-meta">
                    <span>
                      {it.category_id ? catPaths.get(it.category_id)?.split(" › ").pop() : kindLabel(it.kind)}
                    </span>
                    {it.mpn && it.mpn !== it.name && !it.name.includes(it.mpn) && (
                      <span className="mono">{it.mpn}</span>
                    )}
                  </div>
                </div>
                <div className="row-end">
                  <StockCell it={it} />
                </div>
              </Link>
            ))}
          </div>
          {filtered.length > limit && (
            <div className="card-footer center">
              <button type="button" className="btn btn-sm" onClick={() => setLimit((l) => l + 300)}>
                {t.items.showMore(filtered.length - limit)}
              </button>
            </div>
          )}
        </Card>
      )}
    </Page>
  );
}

function StockCell({ it }: { it: ItemSummary }) {
  const t = useT();
  const units = isUnitKind(it.kind);
  const reserved = units ? it.reserved_assets : it.reserved_quantity;
  return (
    <>
      <span className={`qty ${isLow(it) ? "text-warn" : ""}`} style={{ fontWeight: 600 }}>
        {units ? t.common.free(it.available_count, it.asset_count) : itemTotal(it)}
      </span>
      {reserved > 0 && (
        <span className="sub text-warn tiny" style={{ display: "block" }}>
          {t.common.nReserved(units ? String(reserved) : qty(reserved, it.unit))}
        </span>
      )}
      {isLow(it) && (
        <span className="sub tiny muted" style={{ display: "block" }}>
          {t.common.min(qty(it.min_stock ?? 0, it.unit))}
        </span>
      )}
    </>
  );
}
