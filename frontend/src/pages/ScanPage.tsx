import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, get } from "../api";
import { Scanner } from "../components/Scanner";
import { ErrorBox, Page } from "../components/ui";
import { useT } from "../i18n";

interface Resolved {
  code: string;
  path: string;
}

export function ScanPage() {
  const navigate = useNavigate();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState("");
  const t = useT();

  async function open(text: string) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    // The QR payload is a URL ending in the code; Data Matrix holds the code.
    const c = text.trim().split("/").pop() ?? "";
    try {
      const r = await get<Resolved>(`/api/codes/${encodeURIComponent(c)}`);
      navigate(r.path);
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : t.scan.notOurs(text));
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (typed.trim()) open(typed);
  }

  return (
    <Page title={t.scan.title} subtitle={t.scan.subtitle}>
      <div className="stack" style={{ maxWidth: 640, margin: "0 auto" }}>
        <Scanner onCode={open} paused={busy} />
        {message && <ErrorBox error={message} />}
        <div className="divider">{t.scan.orType}</div>
        <form className="row" style={{ flexWrap: "nowrap" }} onSubmit={submit}>
          <input
            placeholder={t.scan.codePh}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoCapitalize="characters"
            className="mono"
            aria-label={t.scan.codeLabel}
          />
          <button type="submit" className="btn btn-primary">
            {t.scan.open}
          </button>
        </form>
      </div>
    </Page>
  );
}
