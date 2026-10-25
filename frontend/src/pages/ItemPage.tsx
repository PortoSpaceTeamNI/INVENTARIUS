import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, ExternalLink, MoreHorizontal, Pencil, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, type Category, get, type ItemDetail } from "../api";
import { AddSheet } from "../components/AddStock";
import { LabelCard } from "../components/LabelCard";
import { DatasheetButton, ReservationList, StockMeter } from "../components/Reservations";
import {
  Card,
  Empty,
  ErrorBox,
  History,
  ItemIcon,
  Loading,
  Menu,
  Page,
  PlaceIcon,
  Stat,
  useToast,
} from "../components/ui";
import { useT } from "../i18n";
import {
  code,
  day,
  errorMessage,
  isUnitKind,
  itemTotal,
  kindLabel,
  locationPaths,
  ownerLabel,
  qty,
  statusLabel,
  stockQty,
  useLocations,
  useMe,
  useMeta,
} from "../lib";
import { categoryPaths } from "./ItemsPage";

const statusBadge: Record<string, string> = {
  available: "badge-ok",
  on_loan: "badge-warn",
  broken: "badge-danger",
  in_repair: "badge-violet",
  retired: "",
};

export function ItemPage() {
  const id = Number(useParams().id);
  const q = useQuery({ queryKey: ["item", id], queryFn: () => get<ItemDetail>(`/api/items/${id}`) });
  const cats = useQuery({ queryKey: ["categories"], queryFn: () => get<Category[]>("/api/categories") });
  const catPaths = useMemo(() => categoryPaths(cats.data), [cats.data]);
  const { data: meta } = useMeta();
  const { data: locs } = useLocations();
  const { data: me } = useMe();
  const paths = useMemo(() => locationPaths(locs), [locs]);
  // ?add=100&lot=... (from scanning a part bag) opens Add stock filled in.
  const [params, setParams] = useSearchParams();
  const [bag] = useState(() =>
    params.has("add") ? { amount: params.get("add") || "1", lot: params.get("lot") ?? "" } : undefined,
  );
  const [adding, setAdding] = useState(bag !== undefined);
  const photoInput = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const t = useT();

  if (q.isPending) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const { item, stock, assets, movements, reservations, can_edit } = q.data;
  const units = isUnitKind(item.kind);
  const counted = stock.filter((s) => s.count_state !== "uncounted");
  const total = counted.reduce((n, s) => n + s.quantity, 0);
  const uncountedLots = stock.length - counted.length;
  const reservedStock = reservations.filter((r) => r.stock_id !== null).reduce((n, r) => n + r.quantity, 0);
  const reservedOn = (stockId: number) =>
    reservations.filter((r) => r.stock_id === stockId).reduce((n, r) => n + r.quantity, 0);
  const totalText = itemTotal({
    total_quantity: total,
    uncounted_lots: uncountedLots,
    approx_lots: stock.filter((s) => s.count_state === "approx").length,
    unit: item.unit,
  });
  const low = !units && uncountedLots === 0 && item.min_stock != null && total < item.min_stock;
  const live = assets.filter((a) => a.status !== "retired");

  async function uploadPhoto(file: File) {
    try {
      await api("PUT", `/api/items/${id}/photo`, file);
      qc.invalidateQueries({ queryKey: ["item", id] });
      qc.invalidateQueries({ queryKey: ["items"] });
      toast(t.item.photoUpdated);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  async function remove() {
    if (!confirm(t.item.confirmDelete(item.name))) return;
    try {
      await api("DELETE", `/api/items/${id}`);
      qc.invalidateQueries();
      navigate("/items", { replace: true });
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  const crumbs = [{ label: t.nav.items, to: "/items" }];
  if (item.category_id && catPaths.get(item.category_id))
    crumbs.push({ label: catPaths.get(item.category_id) ?? "", to: `/items?category=${item.category_id}` });

  return (
    <Page
      crumbs={crumbs}
      title={
        <div className="item-hero">
          <button
            type="button"
            className="photo"
            onClick={() => can_edit && photoInput.current?.click()}
            disabled={!can_edit}
            aria-label={item.photo ? t.item.changePhoto : t.item.addPhoto}
          >
            {item.photo ? (
              <img src={`/photos/${item.photo}`} alt={item.name} />
            ) : (
              <Camera size={26} strokeWidth={1.6} />
            )}
            {can_edit && <span className="photo-edit">{item.photo ? t.item.change : t.item.addPhoto}</span>}
          </button>
          <div style={{ minWidth: 0 }}>
            <div>{item.name}</div>
            <div className="tags" style={{ marginTop: "0.6rem" }}>
              <span className={`badge kind-${item.kind}`}>{kindLabel(item.kind)}</span>
              {item.package && <span className="badge mono">{item.package}</span>}
              <span className="badge">{ownerLabel(meta, item)}</span>
              {low && <span className="badge badge-warn">{t.item.low}</span>}
            </div>
          </div>
          <input
            ref={photoInput}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => e.target.files?.[0] && uploadPhoto(e.target.files[0])}
          />
        </div>
      }
      actions={
        <>
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            <Plus size={16} /> {units ? t.item.addUnits : t.item.addStock}
          </button>
          {can_edit && (
            <Link to={`/items/${id}/edit`} className="btn">
              <Pencil size={15} /> {t.common.edit}
            </Link>
          )}
          {me?.role === "admin" && (
            <Menu
              label={t.common.more}
              trigger={<MoreHorizontal size={18} />}
              items={[
                { label: t.item.deleteItem, icon: <Trash2 size={15} />, onSelect: remove, danger: true },
              ]}
            />
          )}
        </>
      }
    >
      <div className="stats">
        {units ? (
          <>
            <Stat label={t.item.units} value={live.length} />
            <Stat
              label={t.item.available}
              value={<span className="text-ok">{live.filter((a) => a.status === "available").length}</span>}
            />
            <Stat label={t.item.onLoan} value={live.filter((a) => a.status === "on_loan").length} />
            <Stat
              label={t.item.brokenRepair}
              value={live.filter((a) => a.status === "broken" || a.status === "in_repair").length}
            />
          </>
        ) : (
          <>
            <Stat
              label={t.item.inStock}
              value={<span className={low ? "text-warn" : ""}>{totalText}</span>}
              hint={
                item.min_stock != null
                  ? t.item.minimum(qty(item.min_stock, item.unit))
                  : item.unit === "pcs"
                    ? t.common.pieces
                    : item.unit
              }
            />
            <Stat
              label={t.item.freeToUse}
              value={
                uncountedLots && !total ? t.common.lots : qty(Math.max(total - reservedStock, 0), item.unit)
              }
            />
            <Stat label={t.common.reserved} value={qty(reservedStock, item.unit)} />
            <Stat
              label={t.item.places}
              value={stock.length}
              hint={uncountedLots ? t.item.notCounted(uncountedLots) : undefined}
            />
          </>
        )}
      </div>

      <div className="layout-2" style={{ marginTop: "1.25rem" }}>
        <div className="stack" style={{ gap: "1.25rem" }}>
          <Card
            title={units ? t.item.units : t.item.whereItIs}
            count={units ? assets.length : stock.length}
            actions={
              <button type="button" className="btn btn-sm" onClick={() => setAdding(true)}>
                <Plus size={14} /> {t.common.add}
              </button>
            }
          >
            {stock.length === 0 && assets.length === 0 ? (
              <Empty
                title={t.item.noneYet}
                action={
                  <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
                    <Plus size={15} /> {units ? t.item.addUnits : t.item.addStock}
                  </button>
                }
              >
                {units ? t.item.unitsHint : t.item.stockHint}
              </Empty>
            ) : (
              <div className="list">
                {stock.map((s) => {
                  const r = reservedOn(s.id);
                  return (
                    <Link key={s.id} to={`/stock/${s.id}`} className="list-row">
                      <PlaceIcon size={16} />
                      <div className="row-main">
                        <div className="row-title">
                          {paths.get(s.location_id) ?? t.item.location(s.location_id)}
                          <span className="faint"> › </span>
                          <span className="mono">{code.item(item.id)}</span>
                        </div>
                        <div className="row-meta">
                          <span>{t.common.stockN(s.id)}</span>
                          {s.lot && <span>{t.common.lot(s.lot)}</span>}
                          {s.expires_on && <span>{t.item.expires(day(s.expires_on))}</span>}
                          {(s.owner_project_id || s.owner_department_id) && (
                            <span>{ownerLabel(meta, s)}</span>
                          )}
                        </div>
                      </div>
                      <div className="row-end">
                        <span
                          className={`qty ${s.quantity === 0 && s.count_state !== "uncounted" ? "text-danger" : ""}`}
                        >
                          {stockQty(s, item.unit)}
                        </span>
                        {r > 0 && (
                          <span className="sub text-warn">{t.common.nReserved(qty(r, item.unit))}</span>
                        )}
                      </div>
                    </Link>
                  );
                })}
                {assets.map((a) => (
                  <Link key={a.id} to={`/assets/${a.id}`} className="list-row">
                    <ItemIcon kind={item.kind} size={16} />
                    <div className="row-main">
                      <div className="row-title">
                        <span className="mono">A{a.id}</span>
                        {a.serial && <span className="muted"> · {a.serial}</span>}
                      </div>
                      <div className="row-meta">
                        <span>{a.location_id ? paths.get(a.location_id) : t.item.noHome}</span>
                      </div>
                    </div>
                    {reservations.some((r) => r.asset_id === a.id) && (
                      <span className="badge badge-warn">{t.common.reserved}</span>
                    )}
                    <span className={`badge ${statusBadge[a.status]}`}>{statusLabel(a.status)}</span>
                  </Link>
                ))}
              </div>
            )}
            {!units && total > 0 && reservedStock > 0 && (
              <div className="card-footer">
                <StockMeter total={total} reserved={reservedStock} unit={item.unit} />
              </div>
            )}
          </Card>

          {reservations.length > 0 && (
            <Card title={t.common.reserved} count={reservations.length}>
              <ReservationList reservations={reservations} unit={item.unit} />
            </Card>
          )}

          <Card title={t.common.history}>
            <History rows={movements} />
          </Card>
        </div>

        <div className="stack" style={{ gap: "1.25rem" }}>
          <Card title={t.common.details}>
            <div className="card-pad stack">
              <dl className="facts">
                <dt>{t.common.type}</dt>
                <dd>{kindLabel(item.kind)}</dd>
                {item.category_id && (
                  <>
                    <dt>{t.common.category}</dt>
                    <dd>{catPaths.get(item.category_id)}</dd>
                  </>
                )}
                {item.manufacturer && (
                  <>
                    <dt>{t.item.maker}</dt>
                    <dd>{item.manufacturer}</dd>
                  </>
                )}
                {item.mpn && (
                  <>
                    <dt>{t.common.partNo}</dt>
                    <dd className="mono">{item.mpn}</dd>
                  </>
                )}
                {item.package && (
                  <>
                    <dt>{t.common.package}</dt>
                    <dd className="mono">{item.package}</dd>
                  </>
                )}
                <dt>{t.common.owner}</dt>
                <dd>{ownerLabel(meta, item)}</dd>
                {!units && (
                  <>
                    <dt>{t.common.unit}</dt>
                    <dd>{item.unit}</dd>
                  </>
                )}
                {item.hazard_class && (
                  <>
                    <dt>{t.item.hazard}</dt>
                    <dd className="text-danger">{item.hazard_class}</dd>
                  </>
                )}
                {item.storage_notes && (
                  <>
                    <dt>{t.item.storage}</dt>
                    <dd>{item.storage_notes}</dd>
                  </>
                )}
              </dl>
              {item.description && (
                <p className="small" style={{ color: "var(--text-2)" }}>
                  {item.description}
                </p>
              )}
              <div className="row">
                <DatasheetButton url={item.datasheet_url} size="sm" />
                {item.supplier_url && (
                  <a className="btn btn-sm" href={item.supplier_url} target="_blank" rel="noreferrer">
                    <ShoppingCart size={14} /> {t.item.supplier} <ExternalLink size={12} />
                  </a>
                )}
                {!item.datasheet_url && can_edit && (
                  <Link className="btn btn-sm btn-ghost" to={`/items/${id}/edit`}>
                    <Plus size={14} /> {t.item.datasheetLink}
                  </Link>
                )}
              </div>
            </div>
          </Card>

          <Card title={t.item.itemLabel}>
            <p className="small muted" style={{ padding: "0.85rem 1.1rem 0" }}>
              {units ? t.item.labelHintUnits : t.item.labelHintStock}
            </p>
            <LabelCard code={`I${item.id}`} caption={item.label_text || item.name} bare />
          </Card>
        </div>
      </div>

      {adding && (
        <AddSheet
          open
          onClose={() => {
            setAdding(false);
            if (params.has("add")) setParams({}, { replace: true });
          }}
          item={item}
          initial={bag}
        />
      )}
    </Page>
  );
}
