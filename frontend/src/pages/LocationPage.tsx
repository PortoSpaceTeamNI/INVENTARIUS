import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, FileText, MapPin, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, get, type LocationDetail, type Stock } from "../api";
import { ActionSheet } from "../components/ActionSheet";
import { LabelCard } from "../components/LabelCard";
import { LocationSelect } from "../components/pickers";
import {
  Card,
  Empty,
  ErrorBox,
  ItemIcon,
  Loading,
  Menu,
  Page,
  PlaceIcon,
  Sheet,
  useToast,
} from "../components/ui";
import { code, errorMessage, itemTitle, qty, statusLabel, stockQty, useLocations, useMe } from "../lib";
import { NewLocationSheet, useLocationCounts } from "./LocationsPage";

export function LocationPage() {
  const id = Number(useParams().id);
  const q = useQuery({
    queryKey: ["location", id],
    queryFn: () => get<LocationDetail>(`/api/locations/${id}`),
  });
  const { data: locs } = useLocations();
  const { total } = useLocationCounts(locs);
  const { data: me } = useMe();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [taking, setTaking] = useState<{ stock: Stock; name: string; unit: string; reserved: number } | null>(
    null,
  );
  const qc = useQueryClient();
  const toast = useToast();

  if (q.isPending) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const { location: loc, path, children, stock, assets } = q.data;
  const empty = children.length === 0 && stock.length === 0 && assets.length === 0;
  const things = stock.length + assets.length;

  return (
    <Page
      crumbs={[
        { label: "Locations", to: "/locations" },
        ...path.map((p) => ({ label: p.name, to: `/locations/${p.id}` })),
      ]}
      title={
        <span className="row" style={{ gap: "0.6rem" }}>
          {loc.name}
          <span className="badge mono" style={{ fontSize: "0.78rem" }}>
            L{loc.id}
          </span>
        </span>
      }
      subtitle={
        loc.description ||
        (children.length
          ? `${children.length} places inside · ${total.get(loc.id) ?? things} things in total`
          : `${things} ${things === 1 ? "thing" : "things"} here`)
      }
      actions={
        <>
          <Link className="btn btn-primary" to={`/items/new?location=${loc.id}`}>
            <Plus size={16} /> Item here
          </Link>
          <button type="button" className="btn" onClick={() => setAdding(true)}>
            <MapPin size={15} /> Place inside
          </button>
          <Menu
            label="More"
            trigger={<MoreHorizontal size={18} />}
            items={[{ label: "Edit place", icon: <Pencil size={15} />, onSelect: () => setEditing(true) }]}
          />
        </>
      }
    >
      <div className="layout-2">
        <div className="stack" style={{ gap: "1.25rem" }}>
          {children.length > 0 && (
            <section>
              <div className="section-head">
                <h2>
                  Inside <span className="count">{children.length}</span>
                </h2>
              </div>
              <div className="place-grid">
                {[...children]
                  .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
                  .map((c) => (
                    <Link key={c.id} to={`/locations/${c.id}`} className="place-card">
                      <PlaceIcon size={15} />
                      <div>
                        <strong>{c.name}</strong>
                        <small>
                          {total.get(c.id) ?? 0} {(total.get(c.id) ?? 0) === 1 ? "thing" : "things"}
                        </small>
                      </div>
                    </Link>
                  ))}
              </div>
            </section>
          )}

          {(stock.length > 0 || assets.length > 0) && (
            <Card title="Contents" count={things}>
              <div className="list">
                {stock.map((s) => {
                  const lots = s.stock.count_state === "uncounted";
                  const out = s.stock.quantity === 0 && !lots;
                  return (
                    <div key={s.stock.id} className="list-row">
                      <ItemIcon kind={s.item_kind} size={16} />
                      <Link to={`/stock/${s.stock.id}`} className="row-main">
                        <div className="row-title">
                          {itemTitle({ name: s.item_name, package: s.item_package })}
                        </div>
                        <div className="row-meta">
                          <span className="mono">{code.item(s.stock.item_id)}</span>
                          {s.stock.lot && <span>lot {s.stock.lot}</span>}
                          {s.reserved > 0 && (
                            <span className="text-warn">{qty(s.reserved, s.item_unit)} reserved</span>
                          )}
                        </div>
                      </Link>
                      {s.item_datasheet_url && (
                        <a
                          className="btn btn-ghost icon-btn btn-sm only-desktop"
                          href={s.item_datasheet_url}
                          target="_blank"
                          rel="noreferrer"
                          title="Datasheet"
                          aria-label="Datasheet"
                        >
                          <FileText size={16} />
                        </a>
                      )}
                      <div className="row-end">
                        <span className={`qty ${out ? "text-danger" : ""}`}>
                          {stockQty(s.stock, s.item_unit)}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={out}
                        onClick={() =>
                          setTaking({
                            stock: s.stock,
                            name: s.item_name,
                            unit: s.item_unit,
                            reserved: s.reserved,
                          })
                        }
                      >
                        <ArrowUpRight size={14} /> Take
                      </button>
                    </div>
                  );
                })}
                {assets.map((a) => (
                  <Link key={a.asset.id} to={`/assets/${a.asset.id}`} className="list-row">
                    <ItemIcon kind={a.item_kind} size={16} />
                    <div className="row-main">
                      <div className="row-title">{a.item_name}</div>
                      <div className="row-meta">
                        <span className="mono">A{a.asset.id}</span>
                        {a.asset.serial && <span>{a.asset.serial}</span>}
                      </div>
                    </div>
                    {a.reserved && <span className="badge badge-warn">Reserved</span>}
                    <span
                      className={`badge ${a.asset.status === "available" ? "badge-ok" : a.asset.status === "broken" ? "badge-danger" : "badge-warn"}`}
                    >
                      {statusLabel[a.asset.status]}
                    </span>
                  </Link>
                ))}
              </div>
            </Card>
          )}

          {empty && (
            <Card>
              <Empty
                icon={<MapPin size={20} />}
                title="This place is empty"
                action={
                  <div className="row" style={{ justifyContent: "center" }}>
                    <Link className="btn btn-primary" to={`/items/new?location=${loc.id}`}>
                      <Plus size={15} /> Item here
                    </Link>
                    <button type="button" className="btn" onClick={() => setAdding(true)}>
                      <MapPin size={15} /> Place inside
                    </button>
                  </div>
                }
              >
                Put items here, or add drawers and shelves inside it.
              </Empty>
            </Card>
          )}
        </div>

        <div className="stack" style={{ gap: "1.25rem" }}>
          <Card title="Label">
            <LabelCard code={`L${loc.id}`} caption={loc.name} bare />
          </Card>
        </div>
      </div>

      <NewLocationSheet open={adding} onClose={() => setAdding(false)} parentId={loc.id} />
      {editing && (
        <EditLocationSheet
          onClose={() => setEditing(false)}
          detail={q.data}
          canDelete={empty && me?.role === "admin"}
        />
      )}
      {taking && (
        <ActionSheet
          open
          onClose={() => setTaking(null)}
          title="Take"
          subtitle={`${taking.name} · ${loc.name}`}
          submitLabel="Take"
          unit={taking.unit}
          max={taking.stock.count_state === "uncounted" ? undefined : taking.stock.quantity}
          free={
            taking.stock.count_state === "uncounted" ? undefined : taking.stock.quantity - taking.reserved
          }
          askPurpose
          onSubmit={async (v) => {
            await api("POST", `/api/stock/${taking.stock.id}/take`, v);
            qc.invalidateQueries();
            toast(
              `Took ${taking.stock.count_state === "uncounted" ? "some" : qty(v.quantity, taking.unit)} ${taking.name}`,
            );
          }}
        />
      )}
    </Page>
  );
}

function EditLocationSheet(props: { onClose: () => void; detail: LocationDetail; canDelete: boolean }) {
  const loc = props.detail.location;
  const [name, setName] = useState(loc.name);
  const [description, setDescription] = useState(loc.description);
  const [parent, setParent] = useState<number | null>(loc.parent_id);
  const [error, setError] = useState<unknown>(null);
  const qc = useQueryClient();
  const navigate = useNavigate();

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await api("PATCH", `/api/locations/${loc.id}`, { name, description, parent_id: parent });
      qc.invalidateQueries({ queryKey: ["location"] });
      qc.invalidateQueries({ queryKey: ["locations"] });
      props.onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function remove() {
    if (!confirm(`Delete ${loc.name}?`)) return;
    try {
      await api("DELETE", `/api/locations/${loc.id}`);
      qc.invalidateQueries({ queryKey: ["locations"] });
      navigate(loc.parent_id ? `/locations/${loc.parent_id}` : "/locations", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Sheet
      open
      onClose={props.onClose}
      title="Edit place"
      subtitle="Moving it moves everything inside it too."
    >
      <form onSubmit={submit} className="form">
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="field">
          <span>Description</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Grey cabinet by the window"
          />
        </label>
        <label className="field">
          <span>Inside</span>
          <LocationSelect
            value={parent}
            onChange={setParent}
            exclude={loc.id}
            emptyLabel="Nothing — it's a room"
          />
        </label>
        <ErrorBox error={error} />
        <button type="submit" className="btn btn-primary btn-lg btn-block">
          Save
        </button>
        {props.canDelete && (
          <button type="button" className="btn btn-danger btn-block" onClick={remove}>
            <Trash2 size={15} /> Delete place
          </button>
        )}
      </form>
    </Sheet>
  );
}
