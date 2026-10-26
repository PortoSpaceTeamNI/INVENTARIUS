import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { type AssetDetail, type Category, get, type ItemDetail, type StockDetail } from "../api";
import { useT } from "../i18n";
import { itemTitle, locationPaths, statusLabel, stockQty, useAllItems, useLocations } from "../lib";
import { type LinkKind, parseLink } from "../map";
import { categoryPaths } from "../pages/ItemsPage";
import { LocationSelect } from "./pickers";

const linkKinds: LinkKind[] = ["L", "I", "S", "A", "C"];

/**
 * Chooses what a map shape stands for: a place, an item, one stock lot or
 * unit of an item, or a category. Stored as a label code ("L12", "I5"...).
 */
export function LinkPicker(props: { value: string; onChange: (link: string) => void }) {
  const link = parseLink(props.value);
  const [kind, setKind] = useState<LinkKind | "">(link?.kind ?? "");
  const [code, setCode] = useState(props.value);
  const t = useT();
  // Follow outside changes (another shape selected, a place created).
  useEffect(() => {
    setCode(props.value);
    const l = parseLink(props.value);
    if (l) setKind(l.kind);
  }, [props.value]);

  const id = link && link.kind === kind ? link.id : null;
  const set = (k: LinkKind, v: number | null) => props.onChange(v == null ? "" : `${k}${v}`);

  return (
    <div className="stack-sm">
      <label className="field">
        <span>{t.map.linkTo}</span>
        <select
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as LinkKind | "");
            props.onChange("");
          }}
        >
          <option value="">{t.map.linkNothing}</option>
          {linkKinds.map((k) => (
            <option key={k} value={k}>
              {t.map.linkKinds[k]}
            </option>
          ))}
        </select>
      </label>
      {kind === "L" && (
        <LocationSelect value={id} onChange={(v) => set("L", v)} emptyLabel={t.map.notLinkedOption} />
      )}
      {kind === "I" && <ItemPick value={id} onChange={(v) => set("I", v)} />}
      {(kind === "S" || kind === "A") && <LotPick kind={kind} value={id} onChange={(v) => set(kind, v)} />}
      {kind === "C" && <CategoryPick value={id} onChange={(v) => set("C", v)} />}
      <label className="field">
        <span>{t.map.code}</span>
        <input
          className="mono"
          value={code}
          placeholder="L12, I5, S40, A7, C3"
          onChange={(e) => {
            setCode(e.target.value);
            const l = parseLink(e.target.value);
            if (l) {
              setKind(l.kind);
              props.onChange(`${l.kind}${l.id}`);
            } else if (e.target.value.trim() === "") props.onChange("");
          }}
        />
        <span className="field-hint">{t.map.codeHint}</span>
      </label>
    </div>
  );
}

/** An item, found by typing part of its name. */
function ItemPick(props: { value: number | null; onChange: (id: number | null) => void }) {
  const { data: items } = useAllItems();
  const [filter, setFilter] = useState("");
  const t = useT();
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const all = items ?? [];
    const hits = f
      ? all.filter((it) => [it.name, it.mpn, it.label_text].some((v) => v.toLowerCase().includes(f)))
      : all;
    const out = hits.slice(0, 100);
    const cur = all.find((it) => it.id === props.value);
    if (cur && !out.includes(cur)) out.unshift(cur);
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [items, filter, props.value]);
  return (
    <>
      <input
        type="search"
        placeholder={t.map.filterItems}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <select
        value={props.value ?? ""}
        onChange={(e) => props.onChange(e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">{t.map.chooseItem}</option>
        {shown.map((it) => (
          <option key={it.id} value={it.id}>
            {itemTitle(it)} (I{it.id})
          </option>
        ))}
      </select>
    </>
  );
}

/** One stock lot (S) or unit (A) of an item: pick the item, then which one. */
function LotPick(props: { kind: "S" | "A"; value: number | null; onChange: (id: number | null) => void }) {
  const { kind, value } = props;
  // The item the current lot or unit belongs to.
  const owner = useQuery({
    queryKey: ["link-owner", kind, value],
    queryFn: () =>
      kind === "S"
        ? get<StockDetail>(`/api/stock/${value}`).then((d) => d.item.id)
        : get<AssetDetail>(`/api/assets/${value}`).then((d) => d.item.id),
    enabled: value != null,
  });
  const [itemId, setItemId] = useState<number | null>(null);
  const item = itemId ?? owner.data ?? null;
  const detail = useQuery({
    queryKey: ["item", item],
    queryFn: () => get<ItemDetail>(`/api/items/${item}`),
    enabled: item != null,
  });
  const { data: locs } = useLocations();
  const paths = useMemo(() => locationPaths(locs), [locs]);
  const t = useT();
  const d = detail.data;
  return (
    <>
      <ItemPick
        value={item}
        onChange={(v) => {
          setItemId(v);
          props.onChange(null);
        }}
      />
      {d && (
        <select
          value={value ?? ""}
          onChange={(e) => props.onChange(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">{t.map.chooseLot}</option>
          {kind === "S"
            ? d.stock.map((s) => (
                <option key={s.id} value={s.id}>
                  S{s.id} · {paths.get(s.location_id)} · {stockQty(s, d.item.unit)}
                </option>
              ))
            : d.assets.map((a) => (
                <option key={a.id} value={a.id}>
                  A{a.id}
                  {a.serial && ` · ${a.serial}`} · {statusLabel(a.status)}
                </option>
              ))}
        </select>
      )}
    </>
  );
}

function CategoryPick(props: { value: number | null; onChange: (id: number | null) => void }) {
  const cats = useQuery({ queryKey: ["categories"], queryFn: () => get<Category[]>("/api/categories") });
  const paths = useMemo(() => categoryPaths(cats.data), [cats.data]);
  const t = useT();
  return (
    <select
      value={props.value ?? ""}
      onChange={(e) => props.onChange(e.target.value ? Number(e.target.value) : null)}
    >
      <option value="">{t.map.chooseCategory}</option>
      {[...paths.entries()]
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([id, path]) => (
          <option key={id} value={id}>
            {path}
          </option>
        ))}
    </select>
  );
}
