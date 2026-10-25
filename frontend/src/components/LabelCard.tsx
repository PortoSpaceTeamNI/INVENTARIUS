import { useQueryClient } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { useState } from "react";
import { api, type Symbology } from "../api";
import { useT } from "../i18n";
import { errorMessage, useMeta } from "../lib";
import { useToast } from "./ui";

const DOTS_PER_MM = 180 / 25.4;

/** Shows the label as it will print, with a button to print it. "bare"
 * renders it without its own card (to sit inside another card). */
export function LabelCard({ code, caption, bare }: { code: string; caption?: string; bare?: boolean }) {
  const { data: meta } = useMeta();
  const [symbology, setSymbology] = useState<Symbology | null>(null);
  const [withCaption, setWithCaption] = useState(false);
  const [lengthMM, setLengthMM] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();
  const t = useT();

  const sym = symbology ?? meta?.symbology ?? "datamatrix";
  const cap = withCaption && caption ? caption : "";
  const src = `/api/labels/${code}?symbology=${sym}&caption=${encodeURIComponent(cap)}`;

  async function print() {
    setBusy(true);
    try {
      await api("POST", "/api/print", { labels: [{ code, symbology: sym, caption: cap }] });
      toast(t.label.sent(code));
      qc.invalidateQueries({ queryKey: ["print-jobs"] });
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={bare ? "label-card" : "card label-card"}>
      <div className="label-preview">
        <img
          src={src}
          alt={t.label.alt(code)}
          onLoad={(e) => setLengthMM(e.currentTarget.naturalWidth / DOTS_PER_MM)}
        />
      </div>
      <div className="label-controls">
        <div className="segmented" role="radiogroup" aria-label={t.print.codeType}>
          {(["datamatrix", "qr", "code128"] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={sym === s}
              className={sym === s ? "on" : ""}
              onClick={() => setSymbology(s)}
            >
              {s === "datamatrix" ? "Data Matrix" : s === "qr" ? "QR" : t.print.barcode}
            </button>
          ))}
        </div>
        <div className="muted small">
          {t.label.help[sym]} {lengthMM && t.label.length(lengthMM.toFixed(0))}
        </div>
        {caption && (
          <label className="check">
            <input type="checkbox" checked={withCaption} onChange={(e) => setWithCaption(e.target.checked)} />
            {t.label.addCaption(caption.length > 24 ? `${caption.slice(0, 24)}…` : caption)}
          </label>
        )}
        <button
          type="button"
          className="btn btn-primary"
          onClick={print}
          disabled={busy}
          style={{ alignSelf: "flex-start" }}
        >
          <Printer size={16} /> {t.label.print(code)}
        </button>
      </div>
    </div>
  );
}
