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
import {
  errorMessage,
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
        { label: "Items", to: "/items" },
        { label: item.name, to: `/items/${item.id}` },
      ]}
      title={
        <span className="row" style={{ gap: "0.6rem" }}>
          {item.name}
          <span className={`badge ${statusBadge[asset.status]}`} style={{ fontSize: "0.8rem" }}>
            <span className="dot" />
            {statusLabel[asset.status]}
          </span>
        </span>
      }
      subtitle={
        <>
          <span className="mono">A{asset.id}</span>
          {asset.serial && <> · S/N {asset.serial}</>} · {kindLabel[item.kind]} · {ownerLabel(meta, asset)}
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
                    <strong>{mine ? "You have it" : `${open.user_name} has it`}</strong>
                    {(open.loan.project_id || open.loan.department_id) && (
                      <> for {forLabel(meta, open.loan.project_id, open.loan.department_id)}</>
                    )}
                    <div className="small" style={{ opacity: 0.85 }}>
                      Since {when(open.loan.taken_at)}
                      {open.loan.due_at && <> · due {when(open.loan.due_at)}</>}
                      {open.loan.note && <> · “{open.loan.note}”</>}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="row" style={{ gap: "0.9rem", flexWrap: "nowrap" }}>
                  <ItemIcon kind={item.kind} photo={item.photo} />
                  <div>
                    <div className="small muted">Lives in</div>
                    <div style={{ fontWeight: 550 }}>
                      {home && location ? (
                        <Link to={`/locations/${location.id}`}>{home}</Link>
                      ) : (
                        <span className="muted">No home location set</span>
                      )}
                    </div>
                  </div>
                </div>
              )}
              {reservations.length === 0 && !open && asset.status === "available" && (
                <div className="small text-ok">Not reserved — free to use.</div>
              )}
              <div className="action-bar">
                {open ? (
                  <button type="button" className="btn btn-primary btn-lg" onClick={() => setSheet("return")}>
                    <ArrowDownLeft size={18} /> Return it
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary btn-lg"
                    disabled={asset.status !== "available"}
                    onClick={() => setSheet("borrow")}
                  >
                    <ArrowUpRight size={18} /> Borrow
                  </button>
                )}
                {can_edit && (
                  <button type="button" className="btn btn-lg" onClick={() => setSheet("edit")}>
                    <Pencil size={16} /> Edit
                  </button>
                )}
                <Menu
                  label="More actions"
                  up
                  size="lg"
                  trigger={<MoreHorizontal size={18} />}
                  items={[
                    reservations.length === 0 &&
                      asset.status !== "retired" && {
                        label: "Reserve…",
                        icon: <Bookmark size={15} />,
                        onSelect: () => setSheet("reserve"),
                      },
                  ]}
                />
              </div>
              {asset.status !== "available" && !open && (
                <div className="small muted">
                  It can't be borrowed while it is {statusLabel[asset.status].toLowerCase()}.
                </div>
              )}
            </div>
          </Card>

          {reservations.length > 0 && (
            <Card title="Reserved">
              <ReservationList reservations={reservations} />
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
                <dt>Unit</dt>
                <dd className="mono">A{asset.id}</dd>
                {asset.serial && (
                  <>
                    <dt>Serial</dt>
                    <dd className="mono">{asset.serial}</dd>
                  </>
                )}
                <dt>Home</dt>
                <dd>{home ?? "—"}</dd>
                {asset.condition && (
                  <>
                    <dt>Condition</dt>
                    <dd>{asset.condition}</dd>
                  </>
                )}
                <dt>Owner</dt>
                <dd>{ownerLabel(meta, asset)}</dd>
                <dt>Borrowed</dt>
                <dd>
                  <Clock size={13} style={{ verticalAlign: -2 }} /> {loans.length} time
                  {loans.length === 1 ? "" : "s"}
                  {loans.length > 0 && ` · last by ${loans[0].user_name}`}
                </dd>
              </dl>
              {asset.notes && (
                <p className="small" style={{ color: "var(--text-2)" }}>
                  {asset.notes}
                </p>
              )}
              {item.datasheet_url && (
                <div>
                  <DatasheetButton url={item.datasheet_url} size="sm" />
                </div>
              )}
            </div>
          </Card>
          <Card title="Label">
            <LabelCard code={`A${asset.id}`} caption={item.name} bare />
          </Card>
        </div>
      </div>

      {sheet === "reserve" && (
        <ActionSheet
          open
          onClose={() => setSheet(null)}
          title="Reserve"
          subtitle={`${item.name} · A${asset.id}`}
          submitLabel="Reserve"
          askQuantity={false}
          askPurpose
          askUntil
          noteLabel="What is it for?"
          noteRequired
          onSubmit={async (v) => {
            await api("POST", "/api/reservations", { ...v, asset_id: id });
            qc.invalidateQueries();
            toast("Reserved");
          }}
        />
      )}
      {sheet === "borrow" && (
        <ActionSheet
          open
          onClose={() => setSheet(null)}
          title="Borrow"
          subtitle={`${item.name} · A${asset.id}`}
          submitLabel="Borrow"
          askQuantity={false}
          askPurpose
          askDue
          onSubmit={async (v) => {
            await api("POST", `/api/assets/${id}/borrow`, v);
            qc.invalidateQueries();
            toast(`You have ${item.name}`);
          }}
        />
      )}
      {sheet === "return" && (
        <ActionSheet
          open
          onClose={() => setSheet(null)}
          title="Return"
          subtitle={`${item.name} · A${asset.id}`}
          submitLabel="Return"
          askQuantity={false}
          askLocation="optional"
          onSubmit={async (v) => {
            await api("POST", `/api/assets/${id}/return`, { location_id: v.to_location_id, note: v.note });
            qc.invalidateQueries();
            toast("Returned — thanks!");
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
      setError(errorMessage(err));
    }
  }

  async function remove() {
    if (!confirm(`Delete A${a.id} and its history?`)) return;
    try {
      await api("DELETE", `/api/assets/${a.id}`);
      qc.invalidateQueries();
      navigate(`/items/${a.item_id}`, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const onLoan = a.status === "on_loan";
  return (
    <Sheet open onClose={onClose} title={`Edit unit A${a.id}`} subtitle={detail.item.name}>
      <form onSubmit={submit} className="form">
        <div className="field">
          <span className="field-label">Status</span>
          {onLoan ? (
            <span className="field-hint">On loan — return it before changing its status.</span>
          ) : (
            <div className="segmented" role="radiogroup" aria-label="Status">
              {(["available", "broken", "in_repair", "retired"] as AssetStatus[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={status === s}
                  className={status === s ? "on" : ""}
                  onClick={() => setStatus(s)}
                >
                  {statusLabel[s]}
                </button>
              ))}
            </div>
          )}
        </div>
        <label className="field">
          <span>Home location</span>
          <LocationSelect value={location} onChange={setLocation} emptyLabel="— none —" />
        </label>
        <div className="grid-2">
          <label className="field">
            <span>Serial number</span>
            <input value={serial} onChange={(e) => setSerial(e.target.value)} />
          </label>
          <label className="field">
            <span>Condition</span>
            <input
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
              placeholder="e.g. tip worn"
            />
          </label>
        </div>
        <label className="field">
          <span>Owner</span>
          <OrgSelect value={owner} onChange={setOwner} noneLabel="Team (shared)" />
        </label>
        <label className="field">
          <span>Notes</span>
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <ErrorBox error={error} />
        <button type="submit" className="btn btn-primary btn-lg btn-block">
          Save
        </button>
        {me?.role === "admin" && (
          <button type="button" className="btn btn-danger btn-block" onClick={remove}>
            <Trash2 size={15} /> Delete unit
          </button>
        )}
      </form>
    </Sheet>
  );
}
