import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Printer, RefreshCw, RotateCcw, Tag, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { api, get, type PrinterState, type PrintJob, type Symbology, type TapeRoll } from "../api";
import { Card, Empty, ErrorBox, Page, useToast } from "../components/ui";
import { dict, useT } from "../i18n";
import { serverText } from "../i18n/server";
import { errorMessage, useMeta, when } from "../lib";

const statusBadge: Record<PrintJob["status"], string> = {
  queued: "",
  printing: "badge-info",
  done: "badge-ok",
  failed: "badge-danger",
  cancelled: "",
};

const symbolName = (s: Symbology) =>
  s === "datamatrix" ? "Data Matrix" : s === "qr" ? "QR" : dict().print.barcode;

export function PrintPage() {
  const printer = useQuery({
    queryKey: ["printer"],
    queryFn: () => get<PrinterState>("/api/printer"),
    refetchInterval: 15_000,
  });
  const jobs = useQuery({
    queryKey: ["print-jobs"],
    queryFn: () => get<PrintJob[]>("/api/print/jobs"),
    refetchInterval: (q) =>
      q.state.data?.some((j) => j.status === "queued" || j.status === "printing") ? 2000 : 15_000,
  });
  const qc = useQueryClient();
  const toast = useToast();
  const t = useT();

  async function jobOp(j: PrintJob, op: "retry" | "cancel") {
    try {
      await api("POST", `/api/print/jobs/${j.id}/${op}`);
      qc.invalidateQueries({ queryKey: ["print-jobs"] });
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  const p = printer.data;
  const problem = !p
    ? null
    : !p.enabled
      ? t.print.notSetUp
      : serverText(p.error || "") || p.problems.map(serverText).join(", ");
  const ready = p && !problem;

  return (
    <Page title={t.print.title} subtitle={t.print.subtitle}>
      <div className="layout-2">
        <div className="stack" style={{ gap: "1.25rem" }}>
          <BatchPrint />
          <Card title={t.print.recent} count={jobs.data?.length}>
            {jobs.data?.length === 0 ? (
              <Empty icon={<Tag size={20} />} title={t.print.noneYet}>
                {t.print.noneHint}
              </Empty>
            ) : (
              <div className="list">
                {jobs.data?.map((j) => {
                  const cls = statusBadge[j.status];
                  const text = t.print.job[j.status];
                  return (
                    <div key={j.id} className="list-row">
                      <img
                        className="label-thumb"
                        src={`/api/labels/${j.code}?symbology=${j.symbology}&caption=${encodeURIComponent(j.caption)}`}
                        alt=""
                        loading="lazy"
                      />
                      <div className="row-main">
                        <div className="row-title">
                          <Link to={`/c/${j.code}`} className="mono">
                            {j.code}
                          </Link>
                          {j.caption && <span className="muted"> · {j.caption}</span>}
                        </div>
                        <div className="row-meta">
                          <span>{symbolName(j.symbology)}</span>
                          <span>{when(j.created_at)}</span>
                          {j.error && <span className="text-danger">{serverText(j.error)}</span>}
                        </div>
                      </div>
                      <span className={`badge ${cls}`}>{text}</span>
                      {(j.status === "failed" || j.status === "cancelled" || j.status === "done") && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => jobOp(j, "retry")}
                          title={j.status === "done" ? t.print.printAgain : t.print.tryAgain}
                        >
                          <RotateCcw size={14} />
                          <span className="only-desktop">
                            {j.status === "done" ? t.print.reprint : t.print.retry}
                          </span>
                        </button>
                      )}
                      {(j.status === "queued" || j.status === "failed") && (
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost icon-btn"
                          onClick={() => jobOp(j, "cancel")}
                          aria-label={t.common.cancel}
                        >
                          <X size={15} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        <div className="stack" style={{ gap: "1.25rem" }}>
          <Card
            title={t.print.printer}
            actions={
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => printer.refetch()}
                aria-label={t.print.checkPrinter}
              >
                <RefreshCw size={14} /> {t.print.check}
              </button>
            }
          >
            <div className="card-pad stack">
              <div className="row" style={{ gap: "0.85rem", flexWrap: "nowrap" }}>
                <span
                  className={`row-icon ${ready ? "kind-consumable" : "kind-hazmat"}`}
                  style={{ width: 44, height: 44 }}
                >
                  <Printer size={20} />
                </span>
                <div>
                  <div style={{ fontWeight: 600 }}>{p?.model ?? "Brother P-touch"}</div>
                  <div className="row small" style={{ gap: "0.45rem" }}>
                    <span className={`status-dot ${!p ? "" : ready ? "ok" : "bad"}`} />
                    <span className={ready ? "text-ok" : problem ? "text-danger" : "muted"}>
                      {!p
                        ? t.print.checking
                        : ready
                          ? p.busy
                            ? t.print.printingNow
                            : t.print.ready
                          : problem}
                    </span>
                  </div>
                </div>
              </div>
              {p?.enabled && (
                <dl className="facts">
                  <dt>{t.print.tape}</dt>
                  <dd>
                    {p.tape_mm ? `${p.tape_mm} mm` : "—"}
                    {p.tape_mm !== 0 && p.tape_mm !== 12 && p.tape_mm !== 24 && (
                      <span className="text-danger">{t.print.tapeNeed}</span>
                    )}
                  </dd>
                  <dt>{t.print.checked}</dt>
                  <dd>{when(p.checked_at)}</dd>
                </dl>
              )}
              {p?.tape_roll && <TapeGauge roll={p.tape_roll} />}
              <p className="small muted">{t.print.batchNote}</p>
            </div>
          </Card>
        </div>
      </div>
    </Page>
  );
}

const meters = (mm: number) => `${(mm / 1000).toLocaleString(dict().locale, { maximumFractionDigits: 1 })} m`;

/** How much tape is left in the cassette, and a way to start a new one. */
function TapeGauge({ roll }: { roll: TapeRoll }) {
  const [length, setLength] = useState(8000);
  const qc = useQueryClient();
  const toast = useToast();
  const t = useT();
  const left = Math.max(0, roll.length_mm - roll.used_mm);
  const pct = Math.round((100 * left) / roll.length_mm);

  async function newTape() {
    if (!confirm(t.print.newTapeConfirm(roll.width_mm))) return;
    try {
      await api("POST", "/api/printer/tape", { length_mm: length });
      toast(t.print.newTapeDone);
      qc.invalidateQueries({ queryKey: ["printer"] });
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  return (
    <div className="stack" style={{ gap: "0.5rem" }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="small muted">{t.print.tapeLeft}</span>
        <span className={`small ${pct <= 10 ? "text-danger" : pct <= 25 ? "text-warn" : ""}`}>
          {t.print.tapeLeftOf(meters(left), meters(roll.length_mm), pct)}
        </span>
      </div>
      <div
        className="meter"
        role="meter"
        aria-label={t.print.tapeLeft}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <span className={pct <= 10 ? "low" : pct <= 25 ? "reserved" : "free"} style={{ width: `${pct}%` }} />
      </div>
      {pct <= 25 && <p className="small text-warn">{t.print.tapeLow}</p>}
      <p className="small muted">{t.print.tapeSince(when(roll.loaded_at))}</p>
      <div className="row" style={{ flexWrap: "nowrap" }}>
        <select
          value={length}
          onChange={(e) => setLength(Number(e.target.value))}
          aria-label={t.print.newTapeLength}
        >
          <option value={8000}>{t.print.newTapeStd}</option>
          <option value={5000}>5 m</option>
          <option value={4000}>4 m</option>
          <option value={3000}>3 m</option>
          <option value={1500}>{meters(1500)}</option>
        </select>
        <button type="button" className="btn btn-sm" onClick={newTape}>
          <RotateCcw size={14} /> {t.print.newTape}
        </button>
      </div>
    </div>
  );
}

/** Print several codes at once, e.g. "L1-L20" for a new shelf of drawers. */
function BatchPrint() {
  const { data: meta } = useMeta();
  const [text, setText] = useState("");
  const [sym, setSym] = useState<Symbology | "">("");
  const [error, setError] = useState<unknown>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const t = useT();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const codes = expandCodes(text);
      await api("POST", "/api/print", {
        labels: codes.map((code) => ({ code, symbology: sym || meta?.symbology })),
      });
      toast(t.print.sent(codes.length));
      setText("");
      qc.invalidateQueries({ queryKey: ["print-jobs"] });
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Card title={t.print.several}>
      <form className="card-pad form" onSubmit={submit}>
        <label className="field">
          <span>{t.print.codes}</span>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t.print.codesPh}
            autoCapitalize="characters"
            className="mono"
          />
          <span className="field-hint">
            {t.print.rangesPre}
            <code>L1-L66</code>
            {t.print.rangesPost}
          </span>
        </label>
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <select
            value={sym}
            onChange={(e) => setSym(e.target.value as Symbology | "")}
            aria-label={t.print.codeType}
          >
            <option value="">{t.print.default(symbolName(meta?.symbology ?? "datamatrix"))}</option>
            <option value="datamatrix">Data Matrix</option>
            <option value="qr">QR</option>
            <option value="code128">{t.print.barcode}</option>
          </select>
          <button type="submit" className="btn btn-primary" disabled={!text.trim()}>
            <Printer size={15} /> {t.print.print}
          </button>
        </div>
        <ErrorBox error={error} />
      </form>
    </Card>
  );
}

/** "L4-L6, a9" → ["L4", "L5", "L6", "A9"] */
export function expandCodes(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const part = raw.trim().toUpperCase();
    if (!part) continue;
    const range = part.match(/^([LISA])(\d+)-\1?(\d+)$/);
    if (range) {
      const [, k, a, b] = range;
      const from = Number(a);
      const to = Number(b);
      if (to < from || to - from > 199) throw new Error(dict().print.errRange(part));
      for (let i = from; i <= to; i++) out.push(`${k}${i}`);
    } else if (/^[LISA][1-9]\d*$/.test(part)) {
      out.push(part);
    } else {
      throw new Error(dict().print.errCode(raw));
    }
  }
  if (out.length === 0) throw new Error(dict().print.errEmpty);
  if (out.length > 200) throw new Error(dict().print.errTooMany);
  return out;
}
