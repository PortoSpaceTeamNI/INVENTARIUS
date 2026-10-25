import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bookmark,
  Clock,
  MoreHorizontal,
  Pencil,
  Trash2,
  UserRound,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { type AssetDetail, type AssetStatus, api, get } from "../api";
import { ActionSheet } from "../components/ActionSheet";
import { LabelCard } from "../components/LabelCard";
import { LocationSelect, OrgSelect, ownerValue, parseOwnerValue } from "../components/pickers";
import { DatasheetButton, ReservationList } from "../components/Reservations";
import { Card, ErrorBox, History, ItemIcon, Loading, Menu, Page, Sheet, useToast } from "../components/ui";
import { useT } from "../i18n";
import { serverText } from "../i18n/server";
import {
  forLabel,
  kindLabel,
  locationPaths,
  ownerLabel,
  statusLabel,
  useLocations,
  useMe,
  useMeta,
  when,
} from "../lib";

const statusBadge: Record<AssetStatus, string> = {
  available: "badge-ok",
  on_loan: "badge-warn",
  broken: "badge-danger",
  in_repair: "badge-violet",
  retired: "",
};

/** One tool or piece of hardware: what you land on when scanning its label. */
export function AssetPage() {
  const id = Number(useParams().id);
  const q = useQuery({ queryKey: ["asset", id], queryFn: () => get<AssetDetail>(`/api/assets/${id}`) });
  const { data: meta } = useMeta();
  const { data: me } = useMe();
  const { data: locs } = useLocations();
  const [sheet, setSheet] = useState<"borrow" | "return" | "edit" | "reserve" | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const t = useT();

  if (q.isPending) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const { asset, item, location, loans, movements, reservations, can_edit } = q.data;
  const open = loans.find((l) => !l.loan.returned_at);
  const paths = locationPaths(locs);
  const mine = open?.loan.user_id === me?.id;
  const overdue = open?.loan.due_at && new Date(open.loan.due_at) < new Date();
  const home = location ? (paths.get(location.id) ?? location.name) : null;

  return (
    <Page
      crumbs={[
        { label: t.nav.items, to: "/items" },
        { label: item.name, to: `/items/${item.id}` },
      ]}
      title={
        <span className="row" style={{ gap: "0.6rem" }}>
          {item.name}
          <span className={`badge ${statusBadge[asset.status]}`} style={{ fontSize: "0.8rem" }}>
            <span className="dot" />
            {statusLabel(asset.status)}
          </span>
        </span>
      }
      subtitle={
        <>
          <span className="mono">A{asset.id}</span>
          {asset.serial && <> · S/N {asset.serial}</>} · {kindLabel(item.kind)} · {ownerLabel(meta, asset)}
        </>
      }
    >
      <div className="layout-2">
        <div className="stack" style={{ gap: "1.25rem" }}>
          <Card>
            <div className="card-pad stack">
              {open ? (
                <div className={`alert ${overdue ? "alert-danger" : "alert-warn"}`}>
                  <UserRound size={16} />
                  <div>
                    <strong>{mine ? t.asset.youHaveIt : t.asset.hasIt(open.user_name)}</strong>
                    {(open.loan.project_id || open.loan.department_id) &&
                      t.asset.forX(forLabel(meta, open.loan.project_id, open.loan.department_id))}
                    <div className="small" style={{ opacity: 0.85 }}>
                      {t.asset.since(when(open.loan.taken_at))}
                      {open.loan.due_at && <> · {t.asset.due(when(open.loan.due_at))}</>}
                      {open.loan.note && <> · “{open.loan.note}”</>}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="row" style={{ gap: "0.9rem", flexWrap: "nowrap" }}>
                  <ItemIcon kind={item.kind} photo={item.photo} />
                  <div>
                    <div className="small muted">{t.asset.livesIn}</div>
                    <div style={{ fontWeight: 550 }}>
                      {home && location ? (
                        <Link to={`/locations/${location.id}`}>{home}</Link>
                      ) : (
                        <span className="muted">{t.asset.noHome}</span>
                      )}
                    </div>
                  </div>
                </div>
              )}
              {reservations.length === 0 && !open && asset.status === "available" && (
                <div className="small text-ok">{t.asset.notReserved}</div>
              )}
              <div className="action-bar">
                {open ? (
                  <button type="button" className="btn btn-primary btn-lg" onClick={() => setSheet("return")}>
                    <ArrowDownLeft size={18} /> {t.asset.returnIt}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary btn-lg"
                    disabled={asset.status !== "available"}
                    onClick={() => setSheet("borrow")}
                  >
                    <ArrowUpRight size={18} /> {t.asset.borrow}
                  </button>
                )}
                {can_edit && (
                  <button type="button" className="btn btn-lg" onClick={() => setSheet("edit")}>
                    <Pencil size={16} /> {t.common.edit}
                  </button>
                )}
                <Menu
                  label={t.common.moreActions}
                  up
                  size="lg"
                  trigger={<MoreHorizontal size={18} />}
                  items={[
                    reservations.length === 0 &&
                      asset.status !== "retired" && {
                        label: t.stock.reserveMenu,
                        icon: <Bookmark size={15} />,
                        onSelect: () => setSheet("reserve"),
                      },
                  ]}
                />
              </div>
              {asset.status !== "available" && !open && (
                <div className="small muted">{t.asset.cantBorrow(statusLabel(asset.status))}</div>
              )}
            </div>
          </Card>

          {reservations.length > 0 && (
            <Card title={t.common.reserved}>
              <ReservationList reservations={reservations} />
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
                <dt>{t.asset.unit}</dt>
                <dd className="mono">A{asset.id}</dd>
                {asset.serial && (
                  <>
                    <dt>{t.asset.serial}</dt>
                    <dd className="mono">{asset.serial}</dd>
                  </>
                )}
                <dt>{t.asset.home}</dt>
                <dd>{home ?? "—"}</dd>
                {asset.condition && (
                  <>
                    <dt>{t.asset.condition}</dt>
                    <dd>{asset.condition}</dd>
                  </>
                )}
                <dt>{t.common.owner}</dt>
                <dd>{ownerLabel(meta, asset)}</dd>
                <dt>{t.asset.borrowed}</dt>
                <dd>
                  <Clock size={13} style={{ verticalAlign: -2 }} /> {t.asset.times(loans.length)}
                  {loans.length > 0 && t.asset.lastBy(loans[0].user_name)}
                </dd>
              </dl>
              {asset.notes && (
                <p className="small" style={{ color: "var(--text-2)" }}>
                  {serverText(asset.notes)}
                </p>
              )}
              {item.datasheet_url && (
                <div>
                  <DatasheetButton url={item.datasheet_url} size="sm" />
                </div>
              )}
            </div>
          </Card>
          <Card title={t.common.label}>
            <LabelCard code={`A${asset.id}`} caption={item.label_text || item.name} bare />
          </Card>
        </div>
      </div>

      {sheet === "reserve" && (
        <ActionSheet
          open
          onClose={() => setSheet(null)}
          title={t.stock.reserve}
          subtitle={`${item.name} · A${asset.id}`}
          submitLabel={t.stock.reserve}
          askQuantity={false}
          askPurpose
          askUntil
          noteLabel={t.stock.whatFor}
          noteRequired
          onSubmit={async (v) => {
            await api("POST", "/api/reservations", { ...v, asset_id: id });
            qc.invalidateQueries();
            toast(t.asset.reserved);
          }}
        />
      )}
      {sheet === "borrow" && (
        <ActionSheet
          open
          onClose={() => setSheet(null)}
          title={t.asset.borrow}
          subtitle={`${item.name} · A${asset.id}`}
          submitLabel={t.asset.borrow}
          askQuantity={false}
          askPurpose
          askDue
          onSubmit={async (v) => {
            await api("POST", `/api/assets/${id}/borrow`, v);
            qc.invalidateQueries();
            toast(t.asset.youHave(item.name));
          }}
        />
      )}
      {sheet === "return" && (
        <ActionSheet
          open
          onClose={() => setSheet(null)}
          title={t.asset.return}
          subtitle={`${item.name} · A${asset.id}`}
          submitLabel={t.asset.return}
          askQuantity={false}
          askLocation="optional"
          onSubmit={async (v) => {
            await api("POST", `/api/assets/${id}/return`, { location_id: v.to_location_id, note: v.note });
            qc.invalidateQueries();
            toast(t.asset.returned);
          }}
        />
      )}
      {sheet === "edit" && <EditAssetSheet detail={q.data} onClose={() => setSheet(null)} />}
    </Page>
  );
}

function EditAssetSheet({ detail, onClose }: { detail: AssetDetail; onClose: () => void }) {
  const a = detail.asset;
  const [serial, setSerial] = useState(a.serial);
  const [location, setLocation] = useState<number | null>(a.location_id);
  const [condition, setCondition] = useState(a.condition);
  const [status, setStatus] = useState<AssetStatus>(a.status);
  const [notes, setNotes] = useState(a.notes);
  const [owner, setOwner] = useState(ownerValue(a.owner_project_id, a.owner_department_id));
  // The version the sheet was opened with, not whatever a refetch brings.
  const [version] = useState(a.version);
  const [error, setError] = useState<unknown>(null);
  const { data: me } = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const t = useT();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const o = parseOwnerValue(owner);
    try {
      await api("PATCH", `/api/assets/${a.id}`, {
        serial,
        location_id: location,
        condition,
        status,
        notes,
        owner_project_id: o.project_id,
        owner_department_id: o.department_id,
        version,
      });
      qc.invalidateQueries();
      onClose();
    } catch (err) {
      setError(err);
    }
  }

  async function remove() {
    if (!confirm(t.asset.confirmDelete(`A${a.id}`))) return;
    try {
      await api("DELETE", `/api/assets/${a.id}`);
      qc.invalidateQueries();
      navigate(`/items/${a.item_id}`, { replace: true });
    } catch (err) {
      setError(err);
    }
  }

  const onLoan = a.status === "on_loan";
  return (
    <Sheet open onClose={onClose} title={t.asset.editUnit(`A${a.id}`)} subtitle={detail.item.name}>
      <form onSubmit={submit} className="form">
        <div className="field">
          <span className="field-label">{t.asset.status}</span>
          {onLoan ? (
            <span className="field-hint">{t.asset.onLoanHint}</span>
          ) : (
            <div className="segmented" role="radiogroup" aria-label={t.asset.status}>
              {(["available", "broken", "in_repair", "retired"] as AssetStatus[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={status === s}
                  className={status === s ? "on" : ""}
                  onClick={() => setStatus(s)}
                >
                  {statusLabel(s)}
                </button>
              ))}
            </div>
          )}
        </div>
        <label className="field">
          <span>{t.asset.homeLocation}</span>
          <LocationSelect value={location} onChange={setLocation} emptyLabel={t.asset.none} />
        </label>
        <div className="grid-2">
          <label className="field">
            <span>{t.asset.serialNumber}</span>
            <input value={serial} onChange={(e) => setSerial(e.target.value)} />
          </label>
          <label className="field">
            <span>{t.asset.condition}</span>
            <input
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
              placeholder={t.asset.conditionPh}
            />
          </label>
        </div>
        <label className="field">
          <span>{t.common.owner}</span>
          <OrgSelect value={owner} onChange={setOwner} noneLabel={t.common.teamShared} />
        </label>
        <label className="field">
          <span>{t.asset.notes}</span>
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <ErrorBox error={error} />
        <button type="submit" className="btn btn-primary btn-lg btn-block">
          {t.common.save}
        </button>
        {me?.role === "admin" && (
          <button type="button" className="btn btn-danger btn-block" onClick={remove}>
            <Trash2 size={15} /> {t.asset.deleteUnit}
          </button>
        )}
      </form>
    </Sheet>
  );
}
