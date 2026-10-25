import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { type Asset, api, type CountState, type Item } from "../api";
import { dict, useT } from "../i18n";
import { isUnitKind } from "../lib";
import { CountStatePicker } from "./ActionSheet";
import { LocationSelect } from "./pickers";
import { ErrorBox, Sheet, useToast } from "./ui";

/** What is being added: stock of a consumable, or new units of a tool. */
export interface AddValues {
  location: number | null;
  amount: string;
  lot: string;
  expires: string;
  serial: string;
  print: boolean;
  countState: CountState;
}

export const emptyAdd = (location: number | null = null): AddValues => ({
  location,
  amount: "",
  lot: "",
  expires: "",
  serial: "",
  // Labels for stock and units are printed only when asked for.
  print: false,
  countState: "exact",
});

export function wantsAdd(v: AddValues) {
  return v.amount.trim() !== "" || v.countState === "uncounted";
}

export async function addToItem(item: Item, v: AddValues) {
  const t = dict().add;
  if (!v.location) throw new Error(t.chooseWhere);
  const lots = v.countState === "uncounted" && !isUnitKind(item.kind);
  const n = lots ? 0 : Number(v.amount.replace(",", "."));
  if (!lots && !(n > 0)) throw new Error(t.enterAmount);
  if (isUnitKind(item.kind)) {
    if (!Number.isInteger(n) || n > 50) throw new Error(t.unitsLimit);
    await api<Asset[]>("POST", "/api/assets", {
      item_id: item.id,
      location_id: v.location,
      serial: n === 1 ? v.serial : "",
      count: n,
      print_label: v.print,
    });
  } else {
    await api("POST", "/api/stock", {
      item_id: item.id,
      location_id: v.location,
      quantity: n,
      count_state: v.countState,
      lot: v.lot,
      expires_on: v.expires || null,
      print_label: v.print,
    });
  }
}

export function AddFields(props: {
  units: boolean;
  unit: string;
  v: AddValues;
  set: (v: AddValues) => void;
}) {
  const { v, units } = props;
  const set = <K extends keyof AddValues>(k: K, val: AddValues[K]) => props.set({ ...v, [k]: val });
  const lots = !units && v.countState === "uncounted";
  const t = useT();
  return (
    <>
      <label className="field">
        <span>{t.add.where}</span>
        <LocationSelect value={v.location} onChange={(id) => set("location", id)} />
      </label>
      {!units && (
        <div className="field">
          <span className="field-label">{t.add.howWell}</span>
          <CountStatePicker value={v.countState} onChange={(s) => set("countState", s)} />
        </div>
      )}
      <div className="grid-2">
        {!lots && (
          <label className="field">
            <span>
              {units ? t.add.howManyUnits : v.countState === "approx" ? t.add.aboutHowMany : t.add.quantity}
              {!units && props.unit !== "pcs" && ` (${props.unit})`}
            </span>
            <input
              inputMode="decimal"
              value={v.amount}
              onChange={(e) => set("amount", e.target.value)}
              placeholder={units ? "1" : "0"}
            />
          </label>
        )}
        {units ? (
          <label className="field">
            <span>{t.add.serial}</span>
            <input
              value={v.serial}
              onChange={(e) => set("serial", e.target.value)}
              disabled={v.amount !== "" && v.amount !== "1"}
              placeholder={v.amount !== "" && v.amount !== "1" ? t.add.onlySingle : t.common.optional}
            />
          </label>
        ) : (
          <label className="field">
            <span>{t.add.expiry}</span>
            <input type="date" value={v.expires} onChange={(e) => set("expires", e.target.value)} />
          </label>
        )}
      </div>
      {!units && (
        <label className="field">
          <span>{t.add.lot}</span>
          <input value={v.lot} onChange={(e) => set("lot", e.target.value)} placeholder={t.common.optional} />
        </label>
      )}
      <label className="check">
        <input type="checkbox" checked={v.print} onChange={(e) => set("print", e.target.checked)} />
        {units ? t.add.printUnits : t.add.printStock}
      </label>
    </>
  );
}

/** Adds stock to a location, or registers new units of a tool. */
export function AddSheet(props: {
  open: boolean;
  onClose: () => void;
  item: Item;
  /** Values to start from, e.g. read from a distributor's bag label. */
  initial?: Partial<AddValues>;
}) {
  const units = isUnitKind(props.item.kind);
  const [v, setV] = useState<AddValues>(() => ({ ...emptyAdd(), amount: "1", ...props.initial }));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const t = useT();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await addToItem(props.item, v);
      qc.invalidateQueries();
      toast(v.print ? t.add.addedPrinted : t.add.added);
      props.onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={props.open}
      onClose={props.onClose}
      title={units ? t.item.addUnits : t.item.addStock}
      subtitle={props.item.name}
    >
      <form onSubmit={submit} className="form">
        <AddFields units={units} unit={props.item.unit} v={v} set={setV} />
        <ErrorBox error={error} />
        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>
          {busy ? t.common.saving : units ? t.item.addUnits : t.item.addStock}
        </button>
      </form>
    </Sheet>
  );
}
