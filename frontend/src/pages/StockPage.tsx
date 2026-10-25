import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownLeft,
  ArrowRightLeft,
  ArrowUpRight,
  Bookmark,
  ClipboardCheck,
  MoreHorizontal,
  Trash2,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, get, type ItemDetail, type StockDetail } from "../api";
import { ActionSheet, type ActionValues } from "../components/ActionSheet";
import { LabelCard } from "../components/LabelCard";
import { DatasheetButton, ReservationList, StockMeter } from "../components/Reservations";
import { Card, ErrorBox, History, ItemIcon, Loading, Menu, Page, useToast } from "../components/ui";
import { useT } from "../i18n";
import {
  code,
  day,
  errorMessage,
  itemTitle,
  locationPaths,
  ownerLabel,
  qty,
  stockQty,
  useLocations,
  useMe,
  useMeta,
} from "../lib";

type Op = "take" | "return" | "move" | "adjust" | "write-off" | "reserve";

/** A lot of one item in one place: what you land on when scanning a drawer label. */
export function StockPage() {
  const id = Number(useParams().id);
  const q = useQuery({ queryKey: ["stock", id], queryFn: () => get<StockDetail>(`/api/stock/${id}`) });
  const { data: meta } = useMeta();
  const { data: locs } = useLocations();
  const { data: me } = useMe();
  // The item's other lots, so the same part in another drawer is one click away.
  const itemId = q.data?.item.id;
  const siblings = useQuery({
    queryKey: ["item", itemId],
    queryFn: () => get<ItemDetail>(`/api/items/${itemId}`),
    enabled: itemId !== undefined,
  });
  const [op, setOp] = useState<Op | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const t = useT();

  if (q.isPending) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const { stock, item, location, movements, reservations, can_edit } = q.data;
  const unit = item.unit;
  const reserved = reservations.reduce((n, r) => n + r.quantity, 0);
  // Uncounted lots ("lots of M3 nuts") have no number to take from or check.
  const lots = stock.count_state === "uncounted";
  const free = lots ? undefined : stock.quantity - reserved;
  const empty = stock.quantity === 0 && !lots;
  const paths = locationPaths(locs);
  const where = paths.get(location.id) ?? location.name;
  const others = (siblings.data?.stock ?? []).filter((s) => s.id !== stock.id);

  async function run(o: Op, v: ActionValues) {
    if (o === "reserve") {
      await api("POST", "/api/reservations", { ...v, stock_id: id });
      qc.invalidateQueries();
      toast(t.stock.reservedN(qty(v.quantity, unit)));
      return;
    }
    const res = await api<{ id: number }>("POST", `/api/stock/${id}/${o}`, v);
    qc.invalidateQueries();
    const n = lots && o !== "adjust" ? t.stock.some : qty(v.quantity, unit);
    toast(
      {
        take: t.stock.tookN(n),
        return: t.stock.putBackN(n),
        move: t.stock.moved,
        adjust:
          v.count_state === "uncounted" ? t.stock.markedUncounted : t.stock.countSet(qty(v.quantity, unit)),
        "write-off": t.stock.wroteOff(n),
      }[o as Exclude<Op, "reserve">],
    );
    // A partial move can land in another stock row.
    if (o === "move" && res.id !== id) navigate(`/stock/${res.id}`, { replace: true });
  }

  async function remove() {
    if (!confirm(t.stock.confirmRemove)) return;
    try {
      await api("DELETE", `/api/stock/${id}`);
      qc.invalidateQueries();
      navigate(`/items/${item.id}`, { replace: true });
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  const unitWord = unit === "pcs" ? t.common.pieces : unit;
  return (
    <Page
      crumbs={[
        { label: t.nav.items, to: "/items" },
        { label: item.name, to: `/items/${item.id}` },
      ]}
      title={itemTitle(item)}
      subtitle={
        <>
          {/* The bag is labelled with the item code, so that ends the path; the stock id is secondary. */}
          {t.stock.in} <Link to={`/locations/${location.id}`}>{where}</Link>
          <span className="faint"> › </span>
          <Link to={`/items/${item.id}`} className="mono">
            {code.item(item.id)}
          </Link>
          <span className="faint small"> ({t.common.stockN(stock.id)})</span>
        </>
      }
    >
      <div className="layout-2">
        <div className="stack" style={{ gap: "1.25rem" }}>
          <Card>
            <div className="card-pad stack">
              <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
                <div className="row" style={{ gap: "0.9rem", alignItems: "center", flexWrap: "nowrap" }}>
                  <ItemIcon kind={item.kind} photo={item.photo} />
                  <div className={`qty-big ${empty ? "text-danger" : ""}`}>
                    {stockQty(stock)}
                    <small>{lots ? t.stock.notCounted : unitWord}</small>
                  </div>
                </div>
                <div className="tags">
                  {stock.count_state === "approx" && (
                    <span className="badge badge-violet">{t.stock.estimate}</span>
                  )}
                  {lots && <span className="badge">{t.stock.plenty}</span>}
                  {empty && <span className="badge badge-danger">{t.stock.empty}</span>}
                </div>
              </div>
              {!lots && stock.quantity > 0 && reserved > 0 && (
                <StockMeter total={stock.quantity} reserved={reserved} unit={unit} />
              )}
              {!lots && stock.quantity > 0 && reserved === 0 && (
                <div className="row small text-ok" style={{ gap: "0.4rem" }}>
                  <span className="status-dot ok" /> {t.stock.allFree}
                </div>
              )}
              {lots && reserved > 0 && (
                <div className="small text-warn">{t.stock.reservedFromLot(qty(reserved, unit))}</div>
              )}
              <div className="action-bar">
                <button
                  type="button"
                  className="btn btn-primary btn-lg"
                  onClick={() => setOp("take")}
                  disabled={empty}
                >
                  <ArrowUpRight size={18} /> {t.stock.take}
                </button>
                <button type="button" className="btn btn-lg" onClick={() => setOp("return")}>
                  <ArrowDownLeft size={18} /> {t.stock.putBack}
                </button>
                <button type="button" className="btn btn-lg" onClick={() => setOp("move")} disabled={empty}>
                  <ArrowRightLeft size={17} /> {t.stock.move}
                </button>
                <Menu
                  label={t.common.moreActions}
                  up
                  size="lg"
                  trigger={<MoreHorizontal size={18} />}
                  items={[
                    {
                      label: t.stock.reserveMenu,
                      icon: <Bookmark size={15} />,
                      onSelect: () => setOp("reserve"),
                      disabled: free !== undefined && free <= 0,
                    },
                    can_edit && {
                      label: t.stock.countMenu,
                      icon: <ClipboardCheck size={15} />,
                      onSelect: () => setOp("adjust"),
                    },
                    can_edit && {
                      label: t.stock.writeOffMenu,
                      icon: <XCircle size={15} />,
                      onSelect: () => setOp("write-off"),
                      disabled: empty,
                    },
                    stock.quantity === 0 &&
                      (can_edit || me?.role === "admin") && {
                        label: t.stock.removeEmpty,
                        icon: <Trash2 size={15} />,
                        onSelect: remove,
                        danger: true,
                        separatorBefore: true,
                      },
                  ]}
                />
              </div>
            </div>
          </Card>

          {reservations.length > 0 && (
            <Card title={t.common.reserved} count={reservations.length}>
              <ReservationList reservations={reservations} unit={unit} />
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
                <dt>{t.common.item}</dt>
                <dd>
                  <Link to={`/items/${item.id}`}>{item.name}</Link>
                </dd>
                {item.package && (
                  <>
                    <dt>{t.common.package}</dt>
                    <dd className="mono">{item.package}</dd>
                  </>
                )}
                {item.mpn && (
                  <>
                    <dt>{t.common.partNo}</dt>
                    <dd className="mono">{item.mpn}</dd>
                  </>
                )}
                <dt>{t.stock.place}</dt>
                <dd>
                  <Link to={`/locations/${location.id}`}>{where}</Link>
                </dd>
                {others.length > 0 && (
                  <>
                    <dt>{t.stock.alsoIn}</dt>
                    <dd className="stack" style={{ gap: "0.25rem" }}>
                      {others.map((s) => (
                        <Link key={s.id} to={`/stock/${s.id}`}>
                          {paths.get(s.location_id) ?? t.item.location(s.location_id)} › {code.item(item.id)}{" "}
                          <span className="faint small">({t.common.stockN(s.id)})</span>
                        </Link>
                      ))}
                    </dd>
                  </>
                )}
                {stock.lot && (
                  <>
                    <dt>{t.stock.lot}</dt>
                    <dd>{stock.lot}</dd>
                  </>
                )}
                {stock.expires_on && (
                  <>
                    <dt>{t.stock.expires}</dt>
                    <dd>{day(stock.expires_on)}</dd>
                  </>
                )}
                <dt>{t.common.owner}</dt>
                <dd>{ownerLabel(meta, stock)}</dd>
              </dl>
              {item.datasheet_url && (
                <div>
                  <DatasheetButton url={item.datasheet_url} size="sm" />
                </div>
              )}
            </div>
          </Card>
          <Card title={t.common.label}>
            <LabelCard code={code.item(item.id)} caption={item.label_text || item.name} bare />
          </Card>
        </div>
      </div>

      {op === "take" && (
        <ActionSheet
          open
          onClose={() => setOp(null)}
          title={t.stock.take}
          subtitle={`${itemTitle(item)} · ${where}`}
          submitLabel={t.stock.take}
          unit={unit}
          max={lots ? undefined : stock.quantity}
          free={free}
          reservations={reservations}
          askPurpose
          onSubmit={(v) => run("take", v)}
        />
      )}
      {op === "return" && (
        <ActionSheet
          open
          onClose={() => setOp(null)}
          title={t.stock.putBack}
          subtitle={`${itemTitle(item)} · ${where}`}
          submitLabel={t.stock.putBack}
          unit={unit}
          askPurpose
          onSubmit={(v) => run("return", v)}
        />
      )}
      {op === "move" && (
        <ActionSheet
          open
          onClose={() => setOp(null)}
          title={lots ? t.stock.moveAll : t.stock.move}
          subtitle={`${itemTitle(item)} · ${t.stock.from(where)}`}
          submitLabel={t.stock.move}
          unit={unit}
          askQuantity={!lots}
          max={stock.quantity}
          defaultQuantity={stock.quantity}
          askLocation="required"
          excludeLocation={location.id}
          onSubmit={(v) => run("move", v)}
        />
      )}
      {op === "adjust" && (
        <ActionSheet
          open
          onClose={() => setOp(null)}
          title={t.stock.count}
          subtitle={t.stock.countSubtitle}
          submitLabel={t.stock.saveCount}
          unit={unit}
          defaultQuantity={stock.quantity}
          allowZero
          askCountState
          defaultCountState={stock.count_state}
          onSubmit={(v) => run("adjust", v)}
        />
      )}
      {op === "write-off" && (
        <ActionSheet
          open
          onClose={() => setOp(null)}
          title={t.stock.writeOff}
          subtitle={t.stock.writeOffSubtitle}
          submitLabel={t.stock.writeOff}
          unit={unit}
          max={lots ? undefined : stock.quantity}
          noteLabel={t.stock.why}
          danger
          onSubmit={(v) => run("write-off", v)}
        />
      )}
      {op === "reserve" && (
        <ActionSheet
          open
          onClose={() => setOp(null)}
          title={t.stock.reserve}
          subtitle={t.stock.reserveSubtitle}
          submitLabel={t.stock.reserve}
          unit={unit}
          defaultQuantity={free === undefined ? 1 : Math.min(1, free)}
          free={free}
          askPurpose
          askUntil
          noteLabel={t.stock.whatFor}
          noteRequired
          onSubmit={(v) => run("reserve", v)}
        />
      )}
    </Page>
  );
}
