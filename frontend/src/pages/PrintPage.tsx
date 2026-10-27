import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Printer, RefreshCw, RotateCcw, Tag, X } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, get, type PrinterState, type PrintJob, type Symbology } from "../api";
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
          <CustomLabel />
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
                  const custom = customJob(j);
                  return (
                    <div key={j.id} className="list-row">
                      <img
                        className="label-thumb"
                        src={
                          custom
                            ? customSrc(j.caption, custom.qr)
                            : `/api/labels/${j.code}?symbology=${j.symbology}&caption=${encodeURIComponent(j.caption)}`
                        }
                        alt=""
                        loading="lazy"
                      />
                      <div className="row-main">
                        <div className="row-title">
                          {custom ? (
                            <span>{j.caption.replaceAll("\n", " · ") || t.print.custom.qrOnly}</span>
                          ) : (
                            <>
                              <Link to={`/c/${j.code}`} className="mono">
                                {j.code}
                              </Link>
                              {j.caption && <span className="muted"> · {j.caption}</span>}
                            </>
                          )}
                        </div>
                        <div className="row-meta">
                          <span>
                            {custom
                              ? custom.qr
                                ? t.print.custom.withQR
                                : t.print.custom.textOnly
                              : symbolName(j.symbology)}
                          </span>
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
              <p className="small muted">{t.print.batchNote}</p>
            </div>
          </Card>
        </div>
      </div>
    </Page>
  );
}

/** Free-text jobs have a code of "~" followed by their QR content. */
function customJob(j: PrintJob): { qr: string } | null {
  return j.code.startsWith("~") ? { qr: j.code.slice(1) } : null;
}

const customSrc = (text: string, qr: string) =>
  `/api/labels/custom?text=${encodeURIComponent(text)}&qr=${encodeURIComponent(qr)}`;

/** A label with any text (and optionally a QR code), not tied to anything
 * in the inventory: "Do not touch", a cable tag, a link to the wiki. */
function CustomLabel() {
  const [text, setText] = useState("");
  const [qr, setQR] = useState("");
  const [copies, setCopies] = useState(1);
  const [preview, setPreview] = useState<{ src?: string; error?: string }>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const t = useT();
  const empty = !text.trim() && !qr.trim();

  // The preview is drawn by the server, so it is exactly what will print;
  // fetched after a pause in typing.
  useEffect(() => {
    if (empty) {
      setPreview({});
      return;
    }
    let url = "";
    let gone = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(customSrc(text, qr));
        if (!res.ok) {
          const msg = await res
            .json()
            .then((b) => b.error as string)
            .catch(() => res.statusText);
          if (!gone) setPreview({ error: msg });
          return;
        }
        url = URL.createObjectURL(await res.blob());
        if (!gone) setPreview({ src: url });
      } catch (e) {
        if (!gone) setPreview({ error: errorMessage(e) });
      }
    }, 250);
    return () => {
      gone = true;
      clearTimeout(timer);
      if (url) URL.revokeObjectURL(url);
    };
  }, [text, qr, empty]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const label = { text, qr };
      await api("POST", "/api/print", { labels: Array.from({ length: copies }, () => label) });
      toast(t.print.sent(copies));
      qc.invalidateQueries({ queryKey: ["print-jobs"] });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t.print.custom.title}>
      <form className="card-pad form" onSubmit={submit}>
        <label className="field">
          <span>{t.print.custom.text}</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t.print.custom.textPh}
            rows={2}
            maxLength={200}
          />
          <span className="field-hint">{t.print.custom.textHint}</span>
        </label>
        <label className="field">
          <span>{t.print.custom.qr}</span>
          <input
            value={qr}
            onChange={(e) => setQR(e.target.value)}
            placeholder={t.print.custom.qrPh}
            maxLength={300}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <span className="field-hint">{t.print.custom.qrHint}</span>
        </label>
        {!empty && (
          <div className="custom-label-preview">
            {preview.error ? (
              <span className="text-danger small">{serverText(preview.error)}</span>
            ) : (
              preview.src && (
                <div className="label-preview">
                  <img src={preview.src} alt={t.print.custom.alt} />
                </div>
              )
            )}
          </div>
        )}
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <label className="row small" style={{ gap: "0.45rem", flexWrap: "nowrap" }}>
            {t.print.custom.copies}
            <input
              type="number"
              min={1}
              max={50}
              value={copies}
              onChange={(e) => setCopies(Math.min(50, Math.max(1, Math.trunc(Number(e.target.value)) || 1)))}
              style={{ width: "4.5rem" }}
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={empty || busy || !!preview.error}>
            <Printer size={15} /> {t.print.print}
          </button>
        </div>
        <ErrorBox error={error} />
      </form>
    </Card>
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
