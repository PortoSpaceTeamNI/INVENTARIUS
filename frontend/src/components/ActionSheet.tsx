import { type FormEvent, useState } from "react";
import { ApiError, type CountState, type Reservation } from "../api";
import { useT } from "../i18n";
import { serverText } from "../i18n/server";
import { forLabel, loadPurpose, qty, savePurpose, useMe, useMeta } from "../lib";
import { LocationSelect, OrgSelect, ownerValue, parseOwnerValue } from "./pickers";
import { ErrorBox, Sheet } from "./ui";

export interface ActionValues {
  quantity: number;
  project_id: number | null;
  department_id: number | null;
  to_location_id: number | null;
  due_at: string | null;
  until: string | null;
  note: string;
  reservation_id: number | null;
  count_state: CountState;
  /** Set after the user confirmed using things reserved for someone else. */
  override_reserved: boolean;
}

/**
 * One form for every stock/asset action. Fields appear as needed:
 * quantity, who it is for, a destination, a due time and a note.
 * If the server answers 409 (it is reserved for someone else), it asks the
 * user and resubmits with override_reserved.
 */
export function ActionSheet(props: {
  open: boolean;
  onClose: () => void;
  title: string;
  submitLabel: string;
  unit?: string;
  max?: number;
  defaultQuantity?: number;
  askQuantity?: boolean;
  /** For stock counts, where 0 is a valid answer. */
  allowZero?: boolean;
  /** Ask how well it was counted (exact / estimate / not counted). */
  askCountState?: boolean;
  defaultCountState?: CountState;
  askPurpose?: boolean;
  askLocation?: "required" | "optional";
  excludeLocation?: number;
  askDue?: boolean;
  /** Ask for an optional end date (reservations). */
  askUntil?: boolean;
  /** Free (unreserved) quantity, shown next to the quantity. */
  free?: number;
  /** Offer taking from one of these reservations instead of free stock. */
  reservations?: Reservation[];
  noteLabel?: string;
  noteRequired?: boolean;
  subtitle?: string;
  danger?: boolean;
  onSubmit: (v: ActionValues) => Promise<unknown>;
}) {
  const { data: me } = useMe();
  const [quantity, setQuantity] = useState(String(props.defaultQuantity ?? 1));
  const [purpose, setPurpose] = useState(() => {
    const p = loadPurpose(me);
    return ownerValue(p.project_id, p.department_id);
  });
  const { data: meta } = useMeta();
  const [location, setLocation] = useState<number | null>(null);
  const [due, setDue] = useState("");
  const [until, setUntil] = useState("");
  const [countState, setCountState] = useState<CountState>(props.defaultCountState ?? "exact");
  const showQuantity = props.askQuantity !== false && countState !== "uncounted";
  // Preselect a reservation made for the department this person usually works for.
  const [reservation, setReservation] = useState<string>(() => {
    const p = loadPurpose(me);
    const mine = props.reservations?.find(
      (r) => (p.department_id && r.department_id === p.department_id) || r.user_id === me?.id,
    );
    return mine ? String(mine.id) : "";
  });
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const t = useT();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const q = Number(quantity.replace(",", "."));
    if (showQuantity && !(q > 0) && !(props.allowZero && q === 0)) {
      setError(props.allowZero ? t.action.enterCount : t.action.enterQty);
      return;
    }
    const p = parseOwnerValue(purpose);
    if (props.askPurpose) savePurpose(p);
    if (props.noteRequired && !note.trim()) {
      setError(t.action.sayWhat);
      return;
    }
    const values: ActionValues = {
      quantity: q,
      ...(reservation ? { project_id: null, department_id: null } : p),
      to_location_id: location,
      due_at: due ? new Date(due).toISOString() : null,
      until: until || null,
      note,
      reservation_id: reservation ? Number(reservation) : null,
      count_state: countState,
      override_reserved: false,
    };
    setBusy(true);
    try {
      try {
        await props.onSubmit(values);
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 409)) throw err;
        if (!confirm(`${serverText(err.message)}\n\n${t.action.useAnyway}`)) return;
        await props.onSubmit({ ...values, override_reserved: true });
      }
      props.onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={props.open} onClose={props.onClose} title={props.title} subtitle={props.subtitle}>
      <form onSubmit={submit} className="form">
        {props.askCountState && <CountStatePicker value={countState} onChange={setCountState} />}
        {showQuantity && (
          <label className="field">
            <span>
              {t.action.quantity}
              {props.unit && props.unit !== "pcs" ? ` (${props.unit})` : ""}
              {props.max !== undefined && <span className="muted">{t.action.here(props.max)}</span>}
              {props.free !== undefined && props.free !== props.max && (
                <span className="muted">{t.action.free(qty(Math.max(props.free, 0)))}</span>
              )}
            </span>
            <div className="stepper">
              <button
                type="button"
                className="btn"
                onClick={() => setQuantity(String(Math.max(0, Number(quantity) - 1)))}
              >
                −
              </button>
              <input
                inputMode="decimal"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                onFocus={(e) => e.target.select()}
                autoFocus
              />
              <button type="button" className="btn" onClick={() => setQuantity(String(Number(quantity) + 1))}>
                +
              </button>
            </div>
          </label>
        )}
        {props.reservations && props.reservations.length > 0 && (
          <label className="field">
            <span>{t.action.takeFrom}</span>
            <select value={reservation} onChange={(e) => setReservation(e.target.value)}>
              <option value="">
                {t.action.freeStock}
                {props.free !== undefined && ` (${qty(Math.max(props.free, 0))})`}
              </option>
              {props.reservations.map((r) => (
                <option key={r.id} value={r.id}>
                  {t.action.reservedFor(
                    forLabel(meta, r.project_id, r.department_id) || t.common.theTeam,
                    qty(r.quantity),
                    r.note,
                  )}
                </option>
              ))}
            </select>
          </label>
        )}
        {props.askPurpose && !reservation && (
          <label className="field">
            <span>{t.action.for}</span>
            <OrgSelect value={purpose} onChange={setPurpose} noneLabel={t.action.generalTeam} />
          </label>
        )}
        {props.askLocation && (
          <label className="field">
            <span>{props.askLocation === "required" ? t.action.to : t.action.putIn}</span>
            <LocationSelect
              value={location}
              onChange={setLocation}
              exclude={props.excludeLocation}
              required={props.askLocation === "required"}
              emptyLabel={props.askLocation === "required" ? t.common.chooseLocation : t.action.whereBefore}
            />
          </label>
        )}
        {props.askDue && (
          <label className="field">
            <span>{t.action.bringBack}</span>
            <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
        )}
        {props.askUntil && (
          <label className="field">
            <span>{t.action.until}</span>
            <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
          </label>
        )}
        <label className="field">
          <span>{props.noteLabel ?? t.action.note}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t.action.notePh} />
        </label>
        <ErrorBox error={error} />
        <button
          type="submit"
          className={`btn btn-lg btn-block ${props.danger ? "btn-danger solid" : "btn-primary"}`}
          disabled={busy}
        >
          {busy ? t.common.saving : props.submitLabel}
        </button>
      </form>
    </Sheet>
  );
}

const countStates: CountState[] = ["exact", "approx", "uncounted"];

/** Exact count, an estimate, or "plenty, not counted" (screws, nuts). */
export function CountStatePicker(props: { value: CountState; onChange: (v: CountState) => void }) {
  const t = useT();
  return (
    <div className="segmented" role="radiogroup" aria-label={t.action.howCounted}>
      {countStates.map((v) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={props.value === v}
          className={props.value === v ? "on" : ""}
          onClick={() => props.onChange(v)}
        >
          {t.action.countStates[v]}
        </button>
      ))}
    </div>
  );
}
