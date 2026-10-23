import { Printer } from "lucide-react";
import { useState } from "react";
import type { Location, LocationDetail, PrintLabel, Symbology } from "../api";
import { useT } from "../i18n";
import { errorMessage, useLocations, useMeta } from "../lib";
import { usePrint } from "./LabelCard";
import { ErrorBox, Sheet, useToast } from "./ui";

interface Choice {
  code: string;
  name: string;
  depth?: number;
}

const byName = (a: Location, b: Location) => a.name.localeCompare(b.name, undefined, { numeric: true });

/** Every place inside `id`, at any depth, in tree order. */
function placesInside(locs: Location[], id: number): Choice[] {
  const out: Choice[] = [];
  const walk = (parent: number, depth: number) => {
    for (const l of locs.filter((l) => l.parent_id === parent).sort(byName)) {
      out.push({ code: `L${l.id}`, name: l.name, depth });
      if (depth < 32) walk(l.id, depth + 1);
    }
  };
  walk(id, 0);
  return out;
}

/** Pick labels for a place, the places inside it and what it holds, and
 * print them as one strip. Labels get their usual caption. */
export function PrintPickerSheet({ detail, onClose }: { detail: LocationDetail; onClose: () => void }) {
  const { data: locs } = useLocations();
  const { data: meta } = useMeta();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [sym, setSym] = useState<Symbology | "">("");
  const [error, setError] = useState<unknown>(null);
  const sendToPrinter = usePrint();
  const toast = useToast();
  const t = useT();
  const loc = detail.location;

  // Parts carry the item's label (one per item, however many lots).
  const parts = new Map<string, Choice>();
  for (const s of detail.stock) {
    parts.set(`I${s.stock.item_id}`, { code: `I${s.stock.item_id}`, name: s.item_name });
  }
  const groups: { title: string; choices: Choice[] }[] = [
    { title: t.print.pick.thisPlace, choices: [{ code: `L${loc.id}`, name: loc.name }] },
    { title: t.print.pick.inside, choices: placesInside(locs ?? [], loc.id) },
    { title: t.print.pick.parts, choices: [...parts.values()] },
    {
      title: t.print.pick.units,
      choices: detail.assets.map((a) => ({ code: `A${a.asset.id}`, name: a.item_name })),
    },
  ].filter((g) => g.choices.length > 0);
  // Print in the order shown, so the strip follows the list.
  const order = groups.flatMap((g) => g.choices.map((c) => c.code));
  const chosen = order.filter((c) => picked.has(c));

  function set(codes: string[], on: boolean) {
    const next = new Set(picked);
    for (const c of codes) {
      if (on) next.add(c);
      else next.delete(c);
    }
    setPicked(next);
  }

  async function print() {
    setError(null);
    try {
      const labels: PrintLabel[] = chosen.map((code) => ({ code, symbology: sym || meta?.symbology }));
      const held = await sendToPrinter(labels);
      toast(held ? t.print.held(labels.length) : t.print.sent(labels.length));
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <Sheet open onClose={onClose} title={t.print.pick.title} subtitle={t.print.pick.subtitle(loc.name)}>
      <div className="form">
        {groups.map((g) => {
          const codes = g.choices.map((c) => c.code);
          return (
            <fieldset key={g.title} className="pick-group">
              <legend>
                {g.title}{" "}
                {codes.length > 1 && (
                  <>
                    <button type="button" className="link-btn" onClick={() => set(codes, true)}>
                      {t.print.pick.all}
                    </button>
                    {" · "}
                    <button type="button" className="link-btn" onClick={() => set(codes, false)}>
                      {t.print.pick.none}
                    </button>
                  </>
                )}
              </legend>
              {g.choices.map((c) => (
                <label key={c.code} className="check" style={{ paddingLeft: `${(c.depth ?? 0) * 1.1}rem` }}>
                  <input
                    type="checkbox"
                    checked={picked.has(c.code)}
                    onChange={(e) => set([c.code], e.target.checked)}
                  />
                  <span className="mono small">{c.code}</span>
                  <span>{c.name}</span>
                </label>
              ))}
            </fieldset>
          );
        })}
        <ErrorBox error={error} />
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <select
            value={sym}
            onChange={(e) => setSym(e.target.value as Symbology | "")}
            aria-label={t.print.codeType}
          >
            <option value="">
              {t.print.default(symbolName(meta?.symbology ?? "datamatrix", t.print.barcode))}
            </option>
            <option value="datamatrix">Data Matrix</option>
            <option value="qr">QR</option>
            <option value="code128">{t.print.barcode}</option>
          </select>
          <button
            type="button"
            className="btn btn-primary"
            disabled={chosen.length === 0}
            onClick={print}
            style={{ flex: 1 }}
          >
            <Printer size={15} /> {t.print.pick.printN(chosen.length)}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

const symbolName = (s: Symbology, barcode: string) =>
  s === "datamatrix" ? "Data Matrix" : s === "qr" ? "QR" : barcode;
