// Distributor bag labels: the 2D code on Mouser, Digi-Key and Farnell bags
// follows ISO/IEC 15434 (format 06, ANSI MH10.8.2 data identifiers); LCSC
// uses its own "{pc:C123,pm:MPN,qty:100,...}" text.

import type { ItemSummary } from "./api";

export interface BagLabel {
  /** Manufacturer part number. */
  mpn: string;
  quantity: number | null;
  manufacturer: string;
  lot: string;
  /** Distributor part number, e.g. "296-1395-5-ND" (Digi-Key), "C25804" (LCSC). */
  supplierPart: string;
  supplier: "mouser" | "digikey" | "lcsc" | "other";
}

const RS = "\x1e";
const GS = "\x1d";
const EOT = "\x04";

/** Reads a distributor bag code, or returns null if the text is not one. */
export function parseBagLabel(raw: string): BagLabel | null {
  // The decoder may give control characters and spaces as their visible
  // "control pictures" (␞ ␝ ␄ ␠, U+2400–U+2420) instead of the characters.
  const text = raw.replace(/[\u2400-\u2420]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) === 0x2420 ? 0x20 : c.charCodeAt(0) - 0x2400),
  );
  if (text.startsWith(`[)>${RS}06`)) return parseIso15434(text);
  if (/^\{.*\bpm:/.test(text.trim())) return parseLcsc(text.trim());
  return null;
}

function parseIso15434(text: string): BagLabel | null {
  const body = text.slice(`[)>${RS}06`.length).split(RS)[0].replace(EOT, "");
  const fields = new Map<string, string>();
  for (const f of body.split(GS)) {
    // A data identifier is optional digits and one letter: "P", "1P", "11K".
    const m = f.match(/^(\d{0,3}[A-Z])(.*)$/s);
    if (m && !fields.has(m[1])) fields.set(m[1], m[2].trim());
  }
  const mpn = fields.get("1P") ?? "";
  if (!mpn) return null;
  const supplierPart = fields.get("P") ?? "";
  const digikey = supplierPart.endsWith("-ND") || fields.has("11Z") || fields.has("12Z");
  return {
    mpn,
    quantity: quantity(fields.get("Q")),
    // "1V" is the manufacturer on Mouser bags; others may not have it.
    manufacturer: fields.get("1V") ?? "",
    lot: fields.get("1T") ?? "",
    supplierPart: supplierPart === mpn ? "" : supplierPart,
    supplier: digikey ? "digikey" : fields.has("14K") || fields.has("1V") ? "mouser" : "other",
  };
}

function parseLcsc(text: string): BagLabel | null {
  const fields = new Map<string, string>();
  for (const part of text.replace(/^\{|\}$/g, "").split(",")) {
    const i = part.indexOf(":");
    if (i > 0) fields.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  const mpn = fields.get("pm") ?? "";
  if (!mpn) return null;
  return {
    mpn,
    quantity: quantity(fields.get("qty")),
    manufacturer: "",
    lot: "",
    supplierPart: fields.get("pc") ?? "",
    supplier: "lcsc",
  };
}

function quantity(s: string | undefined): number | null {
  const n = Number(s?.replace(/[^\d.]/g, ""));
  return s && Number.isFinite(n) && n > 0 ? n : null;
}

/** A search link for the part at the distributor it came from. */
export function supplierUrl(b: BagLabel): string {
  const q = encodeURIComponent(b.supplierPart || b.mpn);
  switch (b.supplier) {
    case "digikey":
      return `https://www.digikey.pt/en/products/result?keywords=${q}`;
    case "lcsc":
      return `https://www.lcsc.com/search?q=${q}`;
    default:
      return `https://www.mouser.pt/c/?q=${encodeURIComponent(b.mpn)}`;
  }
}

const norm = (s: string) => s.toUpperCase().replace(/[\s\-_/.]/g, "");

/**
 * Items that are this part: the same part number, or (for items imported
 * without one) the part number in the name.
 */
export function matchingItems(items: ItemSummary[], mpn: string): ItemSummary[] {
  const m = norm(mpn);
  const byMpn = items.filter((it) => it.mpn && norm(it.mpn) === m);
  if (byMpn.length > 0 || m.length < 5) return byMpn;
  return items.filter((it) => !it.mpn && norm(it.name).includes(m));
}
