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
      toast(`Reserved ${qty(v.quantity, unit)}`);
      return;
    }
    const res = await api<{ id: number }>("POST", `/api/stock/${id}/${o}`, v);
    qc.invalidateQueries();
    const n = lots && o !== "adjust" ? "some" : qty(v.quantity, unit);
    toast(
      {
        take: `Took ${n}`,
        return: `Put back ${n}`,
        move: "Moved",
        adjust:
          v.count_state === "uncounted" ? "Marked as not counted" : `Count set to ${qty(v.quantity, unit)}`,
        "write-off": `Wrote off ${n}`,
      }[o as Exclude<Op, "reserve">],
    );
    // A partial move can land in another stock row.
    if (o === "move" && res.id !== id) navigate(`/stock/${res.id}`, { replace: true });
  }

  async function remove() {
    if (!confirm("Remove this empty stock entry?")) return;
    try {
      await api("DELETE", `/api/stock/${id}`);
      qc.invalidateQueries();
      navigate(`/items/${item.id}`, { replace: true });
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  const unitWord = unit === "pcs" ? "pieces" : unit;
  return (
    <Page
      crumbs={[
        { label: "Items", to: "/items" },
        { label: item.name, to: `/items/${item.id}` },
      ]}
      title={itemTitle(item)}
      subtitle={
        <>
          {/* The bag is labelled with the item code, so that ends the path; the stock id is secondary. */}
          in <Link to={`/locations/${location.id}`}>{where}</Link>
          <span className="faint"> › </span>
          <Link to={`/items/${item.id}`} className="mono">
            {code.item(item.id)}
          </Link>
          <span className="faint small"> (stock {stock.id})</span>
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
                    <small>{lots ? "not counted" : unitWord}</small>
                  </div>
                </div>
                <div className="tags">
                  {stock.count_state === "approx" && <span className="badge badge-violet">Estimate</span>}
                  {lots && <span className="badge">Plenty</span>}
                  {empty && <span className="badge badge-danger">Empty</span>}
                </div>
              </div>
              {!lots && stock.quantity > 0 && reserved > 0 && (
                <StockMeter total={stock.quantity} reserved={reserved} unit={unit} />
              )}
              {!lots && stock.quantity > 0 && reserved === 0 && (
                <div className="row small text-ok" style={{ gap: "0.4rem" }}>
                  <span className="status-dot ok" /> Nothing reserved — all free to use
                </div>
              )}
              {lots && reserved > 0 && (
                <div className="small text-warn">{qty(reserved, unit)} reserved from this lot</div>
              )}
              <div className="action-bar">
                <button
                  type="button"
                  className="btn btn-primary btn-lg"
                  onClick={() => setOp("take")}
                  disabled={empty}
                >
                  <ArrowUpRight size={18} /> Take
                </button>
                <button type="button" className="btn btn-lg" onClick={() => setOp("return")}>
                  <ArrowDownLeft size={18} /> Put back
                </button>
                <button type="button" className="btn btn-lg" onClick={() => setOp("move")} disabled={empty}>
                  <ArrowRightLeft size={17} /> Move
                </button>
                <Menu
                  label="More actions"
                  up
                  size="lg"
                  trigger={<MoreHorizontal size={18} />}
                  items={[
                    {
                      label: "Reserve…",
                      icon: <Bookmark size={15} />,
                      onSelect: () => setOp("reserve"),
                      disabled: free !== undefined && free <= 0,
                    },
                    can_edit && {
                      label: "Count…",
                      icon: <ClipboardCheck size={15} />,
                      onSelect: () => setOp("adjust"),
                    },
                    can_edit && {
                      label: "Write off…",
                      icon: <XCircle size={15} />,
                      onSelect: () => setOp("write-off"),
                      disabled: empty,
                    },
                    stock.quantity === 0 &&
                      (can_edit || me?.role === "admin") && {
                        label: "Remove empty entry",
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
            <Card title="Reserved" count={reservations.length}>
              <ReservationList reservations={reservations} unit={unit} />
            </Card>
          )}

          <Card title="History">
            <History rows={movements} />
          </Card>
        </div>

        <div className="stack" style={{ gap: "1.25rem" }}>
          <Card title="Details">
            <div className="card-pad stack">
              <dl className="facts">
                <dt>Item</dt>
                <dd>
                  <Link to={`/items/${item.id}`}>{item.name}</Link>
                </dd>
                {item.package && (
                  <>
                    <dt>Package</dt>
                    <dd className="mono">{item.package}</dd>
                  </>
                )}
                {item.mpn && (
                  <>
                    <dt>Part no.</dt>
                    <dd className="mono">{item.mpn}</dd>
                  </>
                )}
                <dt>Place</dt>
                <dd>
                  <Link to={`/locations/${location.id}`}>{where}</Link>
                </dd>
                {others.length > 0 && (
                  <>
                    <dt>Also in</dt>
                    <dd className="stack" style={{ gap: "0.25rem" }}>
                      {others.map((s) => (
                        <Link key={s.id} to={`/stock/${s.id}`}>
                          {paths.get(s.location_id) ?? `Location ${s.location_id}`} › {code.item(item.id)}{" "}
                          <span className="faint small">(stock {s.id})</span>
                        </Link>
                      ))}
                    </dd>
                  </>
                )}
                {stock.lot && (
                  <>
                    <dt>Lot</dt>
                    <dd>{stock.lot}</dd>
                  </>
                )}
                {stock.expires_on && (
                  <>
                    <dt>Expires</dt>
                    <dd>{day(stock.expires_on)}</dd>
                  </>
                )}
                <dt>Owner</dt>
                <dd>{ownerLabel(meta, stock)}</dd>
              </dl>
              {item.datasheet_url && (
                <div>
                  <DatasheetButton url={item.datasheet_url} size="sm" />
                </div>
              )}
            </div>
          </Card>
          <Card title="Label">
            <LabelCard code={code.item(item.id)} caption={item.name} bare />
          </Card>
        </div>
      </div>

      {op === "take" && (
        <ActionSheet
          open
          onClose={() => setOp(null)}
          title="Take"
          subtitle={`${itemTitle(item)} · ${where}`}
          submitLabel="Take"
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
          title="Put back"
          subtitle={`${itemTitle(item)} · ${where}`}
          submitLabel="Put back"
          unit={unit}
          askPurpose
          onSubmit={(v) => run("return", v)}
        />
      )}
      {op === "move" && (
        <ActionSheet
          open
          onClose={() => setOp(null)}
          title={lots ? "Move all of it" : "Move"}
          subtitle={`${itemTitle(item)} · from ${where}`}
          submitLabel="Move"
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
          title="Count"
          subtitle="How many are there right now?"
          submitLabel="Save count"
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
          title="Write off"
          subtitle="Broken, expired or lost"
          submitLabel="Write off"
          unit={unit}
          max={lots ? undefined : stock.quantity}
          noteLabel="Why?"
          danger
          onSubmit={(v) => run("write-off", v)}
        />
      )}
      {op === "reserve" && (
        <ActionSheet
          open
          onClose={() => setOp(null)}
          title="Reserve"
          subtitle="Set it aside so others know it's meant for something"
          submitLabel="Reserve"
          unit={unit}
          defaultQuantity={free === undefined ? 1 : Math.min(1, free)}
          free={free}
          askPurpose
          askUntil
          noteLabel="What is it for?"
          noteRequired
          onSubmit={(v) => run("reserve", v)}
        />
      )}
    </Page>
  );
}
