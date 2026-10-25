import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileSpreadsheet, Upload } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, type ImportResult } from "../api";
import { Card, ErrorBox, Page } from "../components/ui";
import { useT } from "../i18n";
import { serverText } from "../i18n/server";

const example = `name,kind,category,package,quantity,location,owner,reserved,reserved_note
Resistência 10k Ω,consumable,Eletrónica/Resistências,0603,38,Núcleo PST/Caixa 1/Gaveta 6,,,
Porca M8,consumable,Estruturas/Fixação,,+++,Sala FADEUP/Estruturas,INVICTUS/Structures,,
Parafuso M4x12,consumable,Estruturas/Fixação,,52,Sala FADEUP/Estruturas,INVICTUS/Structures,all,Radax
Multímetro,tool,Ferramentas,,3,Núcleo PST/Parede de ferramentas,,,`;

export function ImportPage() {
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const qc = useQueryClient();
  const t = useT();

  async function send(commit: boolean) {
    setBusy(true);
    setError(null);
    try {
      const r = await api<ImportResult>("POST", `/api/import/items${commit ? "?commit=1" : ""}`, csv);
      setResult(r);
      if (r.committed) qc.invalidateQueries();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const bad = result?.rows.filter((r) => r.errors.length > 0) ?? [];
  const lines = csv.trim() ? csv.trim().split("\n").length - 1 : 0;

  return (
    <Page title={t.imp.title} subtitle={t.imp.subtitle}>
      <div className="layout-2">
        <div className="stack" style={{ gap: "1.25rem" }}>
          <Card title={t.imp.step1}>
            <div className="card-pad stack">
              <label
                className="empty"
                style={{
                  border: "1.5px dashed var(--border-strong)",
                  borderRadius: "var(--r-lg)",
                  cursor: "pointer",
                  background: "var(--surface-2)",
                }}
              >
                <span className="empty-icon" style={{ background: "var(--surface)" }}>
                  <Upload size={20} />
                </span>
                <strong>{fileName || t.imp.choose}</strong>
                <span>{fileName ? t.imp.rows(lines) : t.imp.fromSheets}</span>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  hidden
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      setCsv(await f.text());
                      setFileName(f.name);
                      setResult(null);
                    }
                  }}
                />
              </label>
              <details>
                <summary className="small muted" style={{ cursor: "pointer" }}>
                  {t.imp.paste}
                </summary>
                <textarea
                  className="mono"
                  rows={8}
                  style={{ marginTop: "0.6rem", fontSize: "0.8rem" }}
                  value={csv}
                  onChange={(e) => {
                    setCsv(e.target.value);
                    setFileName("");
                    setResult(null);
                  }}
                  placeholder={example}
                />
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  style={{ marginTop: "0.4rem" }}
                  onClick={() => {
                    setCsv(example);
                    setFileName("");
                    setResult(null);
                  }}
                >
                  {t.imp.useExample}
                </button>
              </details>
            </div>
          </Card>

          <Card title={t.imp.step2}>
            <div className="card-pad stack">
              <p className="small muted">{t.imp.note}</p>
              <div className="row">
                <button
                  type="button"
                  className="btn"
                  disabled={!csv.trim() || busy}
                  onClick={() => send(false)}
                >
                  <FileSpreadsheet size={15} /> {t.imp.check}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!result?.valid || result.committed || busy}
                  onClick={() => send(true)}
                >
                  <Upload size={15} /> {t.imp.import}{" "}
                  {result?.valid && !result.committed && t.imp.rows(result.rows.length)}
                </button>
              </div>
              <ErrorBox error={error} />
              {result?.committed && (
                <div className="alert alert-ok">
                  <CheckCircle2 size={16} />
                  <span>
                    {t.imp.importedPre(result.rows.length, result.created_items ?? 0)}
                    <Link to="/locations">{t.nav.locations}</Link>
                    {t.imp.or}
                    <Link to="/print">{t.nav.labels}</Link>.
                  </span>
                </div>
              )}
              {result && !result.committed && result.valid && (
                <div className="alert alert-ok">
                  <CheckCircle2 size={16} />
                  <span>{t.imp.allGood(result.rows.length)}</span>
                </div>
              )}
            </div>
            {bad.length > 0 && (
              <>
                <div className="card-header" style={{ borderTop: "1px solid var(--border)" }}>
                  <h2 className="text-danger">
                    {t.imp.toFix} <span className="count">{bad.length}</span>
                  </h2>
                </div>
                <div className="list">
                  {bad.map((r) => (
                    <div key={r.line} className="list-row">
                      <span className="badge mono">{t.imp.line(r.line)}</span>
                      <div className="row-main">
                        <div className="row-title">{r.name || t.imp.noName}</div>
                        <div className="small text-danger">{r.errors.map(serverText).join(" · ")}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Card>
        </div>

        <Card title={t.imp.columnsTitle}>
          <div className="card-pad stack-sm">
            <p className="small muted">{t.imp.columnsNote}</p>
            <dl className="facts small" style={{ gridTemplateColumns: "1fr", gap: "0.1rem" }}>
              {t.imp.columns.map(([c, help]) => (
                <div key={c} style={{ padding: "0.35rem 0", borderBottom: "1px solid var(--border)" }}>
                  <dt>
                    <code style={{ color: "var(--text)" }}>{c}</code>
                  </dt>
                  <dd className="muted">{help}</dd>
                </div>
              ))}
            </dl>
          </div>
        </Card>
      </div>
    </Page>
  );
}
