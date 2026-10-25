import { describe, expect, it } from "vitest";
import type { ItemSummary } from "./api";
import { matchingItems, parseBagLabel, supplierUrl } from "./distributor";

const RS = "\x1e";
const GS = "\x1d";
const EOT = "\x04";
const iso = (...fields: string[]) => `[)>${RS}06${GS}${fields.join(GS)}${RS}${EOT}`;

describe("parseBagLabel", () => {
  it("reads a Mouser bag", () => {
    const b = parseBagLabel(
      iso("KPST-2026-14", "14K001", "1PGRM188R71H104KA93D", "Q250", "11K068123456", "4LJP", "1VMurata"),
    );
    expect(b).toEqual({
      mpn: "GRM188R71H104KA93D",
      quantity: 250,
      manufacturer: "Murata",
      lot: "",
      supplierPart: "",
      supplier: "mouser",
    });
    expect(b && supplierUrl(b)).toBe("https://www.mouser.pt/c/?q=GRM188R71H104KA93D");
  });

  it("reads a Digi-Key bag", () => {
    const b = parseBagLabel(
      iso(
        "P296-1395-5-ND",
        "1PLM358P",
        "K",
        "1K12345678",
        "10K87654321",
        "9D2318",
        "1TABC123",
        "Q10",
        "11ZPICK",
      ),
    );
    expect(b).toMatchObject({
      mpn: "LM358P",
      quantity: 10,
      lot: "ABC123",
      supplierPart: "296-1395-5-ND",
      supplier: "digikey",
    });
    expect(b && supplierUrl(b)).toContain("digikey");
  });

  it("reads an LCSC bag", () => {
    const b = parseBagLabel("{pbn:PICK2301,on:SO2301,pc:C25804,pm:0603WAF1002T5E,qty:100,mc:,cc:1}");
    expect(b).toMatchObject({
      mpn: "0603WAF1002T5E",
      quantity: 100,
      supplierPart: "C25804",
      supplier: "lcsc",
    });
  });

  it("reads separators shown as control pictures", () => {
    // What zxing-cpp gives for the code in its default text mode.
    const b = parseBagLabel("[)>␞06␝KPST-2026-14␝14K001␝1PGRM188R71H104KA93D␝Q250␝4LJP␝1VMurata␞␄");
    expect(b).toMatchObject({ mpn: "GRM188R71H104KA93D", quantity: 250, manufacturer: "Murata" });
  });

  it("reads a real Mouser bag as the decoder gives it", () => {
    // From a photo of a bag: separators and the space as control pictures.
    const b = parseBagLabel(
      "[)>␞06␝K38819908␝14K058␝1PCL05X105KO5NQWC␝Q30␝11K089915392␝4LCN␝1VSamsung␠Electro-Mechanics␞␄",
    );
    expect(b).toEqual({
      mpn: "CL05X105KO5NQWC",
      quantity: 30,
      manufacturer: "Samsung Electro-Mechanics",
      lot: "",
      supplierPart: "",
      supplier: "mouser",
    });
  });

  it("ignores our own labels and unknown codes", () => {
    expect(parseBagLabel("A107")).toBeNull();
    expect(parseBagLabel("HTTP://LOCALHOST:8080/A107")).toBeNull();
    expect(parseBagLabel(iso("KPO123", "Q5"))).toBeNull(); // no part number
  });
});

const item = (id: number, name: string, mpn: string) => ({ id, name, mpn }) as ItemSummary;

describe("matchingItems", () => {
  const items = [
    item(1, "Capacitor 100nF 0603", "GRM188R71H104KA93D"),
    item(2, "LM358 op-amp", ""),
    item(3, "Op-amp LM358P (DIP)", ""),
    item(4, "Resistor 10k", "0603WAF1002T5E"),
  ];
  it("matches the part number, ignoring case and separators", () => {
    expect(matchingItems(items, "grm188r71h104ka93d").map((i) => i.id)).toEqual([1]);
    expect(matchingItems(items, "0603-WAF1002T5E").map((i) => i.id)).toEqual([4]);
  });
  it("falls back to items named after the part", () => {
    expect(matchingItems(items, "LM358P").map((i) => i.id)).toEqual([3]);
  });
  it("finds nothing for a new part", () => {
    expect(matchingItems(items, "BMP390")).toEqual([]);
  });
});
