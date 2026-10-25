import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Printer, RefreshCw, RotateCcw, Tag, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { api, get, type PrinterState, type PrintJob, type Symbology } from "../api";
import { Card, Empty, ErrorBox, Page, useToast } from "../components/ui";
import { errorMessage, useMeta, when } from "../lib";

const statusBadge: Record<PrintJob["status"], [string, string]> = {
  queued: ["", "Waiting"],
  printing: ["badge-info", "Printing"],
  done: ["badge-ok", "Printed"],
  failed: ["badge-danger", "Failed"],
  cancelled: ["", "Cancelled"],
};

const symbolName: Record<Symbology, string> = { datamatrix: "Data Matrix", qr: "QR", code128: "Barcode" };

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

  async function jobOp(j: PrintJob, op: "retry" | "cancel") {
    try {
      await api("POST", `/api/print/jobs/${j.id}/${op}`);
      qc.invalidateQueries({ queryKey: ["print-jobs"] });
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  const p = printer.data;
  const problem = !p ? null : !p.enabled ? "Not set up on the server" : p.error || p.problems.join(", ");
  const ready = p && !problem;

  return (
    <Page title="Labels" subtitle="Brother PT-E550W · 12 or 24 mm tape">
      <div className="layout-2">
        <div className="stack" style={{ gap: "1.25rem" }}>
          <BatchPrint />
          <Card title="Recent print jobs" count={jobs.data?.length}>
            {jobs.data?.length === 0 ? (
              <Empty icon={<Tag size={20} />} title="No labels printed yet">
                Labels print automatically when you create places, add stock and register units.
              </Empty>
            ) : (
              <div className="list">
                {jobs.data?.map((j) => {
                  const [cls, text] = statusBadge[j.status];
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
                          <span>{symbolName[j.symbology]}</span>
                          <span>{when(j.created_at)}</span>
                          {j.error && <span className="text-danger">{j.error}</span>}
                        </div>
                      </div>
                      <span className={`badge ${cls}`}>{text}</span>
                      {(j.status === "failed" || j.status === "cancelled" || j.status === "done") && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => jobOp(j, "retry")}
                          title={j.status === "done" ? "Print again" : "Try again"}
                        >
                          <RotateCcw size={14} />
                          <span className="only-desktop">{j.status === "done" ? "Reprint" : "Retry"}</span>
                        </button>
                      )}
                      {(j.status === "queued" || j.status === "failed") && (
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost icon-btn"
                          onClick={() => jobOp(j, "cancel")}
                          aria-label="Cancel"
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
            title="Printer"
            actions={
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => printer.refetch()}
                aria-label="Check the printer"
              >
                <RefreshCw size={14} /> Check
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
                      {!p ? "Checking…" : ready ? (p.busy ? "Printing…" : "Ready") : problem}
                    </span>
                  </div>
                </div>
              </div>
              {p?.enabled && (
                <dl className="facts">
                  <dt>Tape</dt>
                  <dd>
                    {p.tape_mm ? `${p.tape_mm} mm` : "—"}
                    {p.tape_mm !== 0 && p.tape_mm !== 12 && p.tape_mm !== 24 && (
                      <span className="text-danger"> · labels need 12 or 24 mm</span>
                    )}
                  </dd>
                  <dt>Checked</dt>
                  <dd>{when(p.checked_at)}</dd>
                </dl>
              )}
              <p className="small muted">
                Labels created within a few seconds of each other print together as one strip, so less tape is
                wasted.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </Page>
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

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const codes = expandCodes(text);
      await api("POST", "/api/print", {
        labels: codes.map((code) => ({ code, symbology: sym || meta?.symbology })),
      });
      toast(`${codes.length} ${codes.length === 1 ? "label" : "labels"} sent to the printer`);
      setText("");
      qc.invalidateQueries({ queryKey: ["print-jobs"] });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Card title="Print several labels">
      <form className="card-pad form" onSubmit={submit}>
        <label className="field">
          <span>Codes</span>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. L4-L12, A7, A9"
            autoCapitalize="characters"
            className="mono"
          />
          <span className="field-hint">
            Ranges work too: <code>L1-L66</code> prints every drawer label at once.
          </span>
        </label>
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <select
            value={sym}
            onChange={(e) => setSym(e.target.value as Symbology | "")}
            aria-label="Code type"
          >
            <option value="">Default ({symbolName[meta?.symbology ?? "datamatrix"]})</option>
            <option value="datamatrix">Data Matrix</option>
            <option value="qr">QR</option>
            <option value="code128">Barcode</option>
          </select>
          <button type="submit" className="btn btn-primary" disabled={!text.trim()}>
            <Printer size={15} /> Print
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
      if (to < from || to - from > 199) throw new Error(`Range ${part} is backwards or too long.`);
      for (let i = from; i <= to; i++) out.push(`${k}${i}`);
    } else if (/^[LISA][1-9]\d*$/.test(part)) {
      out.push(part);
    } else {
      throw new Error(`“${raw}” is not a label code.`);
    }
  }
  if (out.length === 0) throw new Error("Enter at least one code.");
  if (out.length > 200) throw new Error("At most 200 labels at once.");
  return out;
}
