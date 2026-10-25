import { useQueryClient } from "@tanstack/react-query";
import { Bookmark, FileText } from "lucide-react";
import { api, type Reservation } from "../api";
import { useT } from "../i18n";
import { day, errorMessage, forLabel, qty, useMe, useMeta, when } from "../lib";
import { useToast } from "./ui";

/** What is set aside, for whom and why, with a Release button. */
export function ReservationList({ reservations, unit }: { reservations: Reservation[]; unit?: string }) {
  const { data: meta } = useMeta();
  const { data: me } = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const t = useT();

  async function release(r: Reservation) {
    if (!confirm(t.resv.confirmRelease(r.note))) return;
    try {
      await api("POST", `/api/reservations/${r.id}/release`);
      qc.invalidateQueries();
      toast(t.resv.released);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  return (
    <div className="list">
      {reservations.map((r) => {
        const mine =
          r.user_id === me?.id ||
          me?.role === "admin" ||
          (r.department_id !== null && me?.department_ids.includes(r.department_id)) ||
          (r.department_id === null && r.project_id === null) ||
          (r.department_id === null &&
            meta?.departments.some(
              (d) => d.project_id === r.project_id && me?.department_ids.includes(d.id),
            ));
        return (
          <div key={r.id} className="list-row">
            <span className="row-icon kind-flight_hw">
              <Bookmark size={16} />
            </span>
            <div className="row-main">
              <div className="row-title">
                {r.stock_id !== null && <span className="num">{qty(r.quantity, unit)} </span>}
                {t.resv.for(forLabel(meta, r.project_id, r.department_id) || t.common.theTeam)}
              </div>
              <div className="row-meta">
                <span>“{r.note}”</span>
                <span>
                  {r.user_name}, {when(r.created_at)}
                </span>
                {r.until && <span>{t.resv.until(day(r.until))}</span>}
              </div>
            </div>
            {mine && (
              <button type="button" className="btn btn-sm" onClick={() => release(r)}>
                {t.resv.release}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Bar showing how much of the stock is free and how much is reserved. */
export function StockMeter({ total, reserved, unit }: { total: number; reserved: number; unit?: string }) {
  const free = Math.max(total - reserved, 0);
  const short = reserved - total;
  const pct = (n: number) => `${total > 0 ? Math.min((n / total) * 100, 100) : 0}%`;
  const t = useT();
  return (
    <div className="stack-sm">
      <div className="meter" aria-hidden="true">
        <span className="free" style={{ width: pct(free) }} />
        <span className="reserved" style={{ width: pct(Math.min(reserved, total)) }} />
      </div>
      <div className="legend">
        <span>
          <i style={{ background: "var(--ok)" }} />
          <strong className="num">{qty(free, unit)}</strong> {t.resv.freeToUse}
        </span>
        {reserved > 0 && (
          <span>
            <i style={{ background: "var(--warn)" }} />
            <strong className="num">{qty(reserved, unit)}</strong> {t.resv.reserved}
          </span>
        )}
        {short > 0 && <span className="text-danger">{t.resv.short(qty(short, unit))}</span>}
      </div>
    </div>
  );
}

export function DatasheetButton({ url, size }: { url: string; size?: "sm" }) {
  const t = useT();
  if (!url) return null;
  return (
    <a className={`btn ${size === "sm" ? "btn-sm" : ""}`} href={url} target="_blank" rel="noreferrer">
      <FileText size={15} /> {t.common.datasheet}
    </a>
  );
}
