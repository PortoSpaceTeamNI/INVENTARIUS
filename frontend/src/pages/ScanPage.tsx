import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, get } from "../api";
import { Scanner } from "../components/Scanner";
import { ErrorBox, Page } from "../components/ui";
import { type BagLabel, matchingItems, parseBagLabel, supplierUrl } from "../distributor";
import { useT } from "../i18n";
import { allItemsQuery, errorMessage } from "../lib";

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
  const qc = useQueryClient();

  /**
   * A part bag from Mouser, Digi-Key or LCSC: add to the item that has this
   * part number, or start a new item filled in from the label.
   */
  async function openBag(bag: BagLabel) {
    try {
      const items = await qc.fetchQuery(allItemsQuery);
      const found = matchingItems(items, bag.mpn);
      const qty = bag.quantity ? String(bag.quantity) : "";
      if (found.length === 1) {
        navigate(`/items/${found[0].id}?${new URLSearchParams({ add: qty, lot: bag.lot })}`);
      } else if (found.length > 1) {
        navigate(`/items?${new URLSearchParams({ q: bag.mpn })}`);
      } else {
        const p = new URLSearchParams({
          mpn: bag.mpn,
          manufacturer: bag.manufacturer,
          supplier_url: supplierUrl(bag),
          qty,
          lot: bag.lot,
        });
        navigate(`/items/new?${p}`);
      }
    } catch (e) {
      setMessage(errorMessage(e));
      setBusy(false);
    }
  }

  async function open(text: string) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const bag = parseBagLabel(text);
    if (bag) return openBag(bag);
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
