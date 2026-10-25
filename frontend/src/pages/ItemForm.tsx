import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Plus, ScanLine } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ApiError,
  api,
  type Category,
  get,
  type Item,
  type ItemDetail,
  type ItemKind,
  type PartInfo,
} from "../api";
import { AddFields, type AddValues, addToItem, emptyAdd, wantsAdd } from "../components/AddStock";
import { OrgSelect, ownerValue, parseOwnerValue } from "../components/pickers";
import { ErrorBox, Loading, Page } from "../components/ui";
import { useT } from "../i18n";
import { errorMessage, isUnitKind, itemKinds, kindLabel, useMeta } from "../lib";
import { categoryPaths } from "./ItemsPage";

export function ItemEditPage() {
  const params = useParams();
  const editId = params.id ? Number(params.id) : null;
  const [search] = useSearchParams();
  const existing = useQuery({
    queryKey: ["item", editId],
    queryFn: () => get<ItemDetail>(`/api/items/${editId}`),
    enabled: editId !== null,
  });
  if (editId !== null && existing.isPending) return <Loading />;
  // ?mpn=...&qty=... comes from scanning a distributor's part bag.
  const fromBag = editId === null && search.has("mpn");
  return (
    <ItemForm
      key={editId ?? "new"}
      item={existing.data?.item}
      defaultLocation={search.get("location") ? Number(search.get("location")) : null}
      prefill={
        fromBag
          ? {
              mpn: search.get("mpn") ?? "",
              manufacturer: search.get("manufacturer") ?? "",
              supplier_url: search.get("supplier_url") ?? "",
              qty: search.get("qty") ?? "",
              lot: search.get("lot") ?? "",
            }
          : undefined
      }
    />
  );
}

interface Prefill {
  mpn: string;
  manufacturer: string;
  supplier_url: string;
  qty: string;
  lot: string;
}

function Section(props: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="form-section">
      <div className="form-section-title">
        <h3>{props.title}</h3>
        {props.hint && <p>{props.hint}</p>}
      </div>
      <div className="form-section-body">{props.children}</div>
    </div>
  );
}

function ItemForm({
  item,
  defaultLocation,
  prefill,
}: {
  item?: Item;
  defaultLocation: number | null;
  prefill?: Prefill;
}) {
  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => get<Category[]>("/api/categories"),
  });
  const catPaths = useMemo(() => categoryPaths(categories.data), [categories.data]);
  const [f, setF] = useState({
    // A bag label has no description; the part number is a start for the name.
    name: item?.name ?? prefill?.mpn ?? "",
    kind: item?.kind ?? ("consumable" as ItemKind),
    category_id: item?.category_id ?? null,
    description: item?.description ?? "",
    manufacturer: item?.manufacturer ?? prefill?.manufacturer ?? "",
    mpn: item?.mpn ?? prefill?.mpn ?? "",
    package: item?.package ?? "",
    label_text: item?.label_text ?? "",
    supplier_url: item?.supplier_url ?? prefill?.supplier_url ?? "",
    datasheet_url: item?.datasheet_url ?? "",
    unit: item?.unit ?? "pcs",
    min_stock: item?.min_stock?.toString() ?? "",
    hazard_class: item?.hazard_class ?? "",
    storage_notes: item?.storage_notes ?? "",
    owner: item ? ownerValue(item.owner_project_id, item.owner_department_id) : "",
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  // The version the form was opened with, not whatever a refetch brings.
  const [version] = useState(item?.version);
  const [add, setAdd] = useState<AddValues>(() => ({
    ...emptyAdd(defaultLocation),
    amount: prefill?.qty ?? "",
    lot: prefill?.lot ?? "",
  }));
  const [newCat, setNewCat] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const t = useT();
  const units = isUnitKind(f.kind);
  const { data: meta } = useMeta();
  const [lookup, setLookup] = useState<"busy" | "done" | "notFound" | ApiError | null>(null);
  const [photoUrl, setPhotoUrl] = useState("");

  /**
   * Fills in what Mouser's catalogue knows about the part number: fields
   * still empty (or still the bare part number) get the catalogue's values.
   */
  async function lookUp(mpn: string) {
    if (!mpn.trim()) return;
    setLookup("busy");
    try {
      const p = await get<PartInfo>(`/api/parts?mpn=${encodeURIComponent(mpn.trim())}`);
      // A search link (from a bag) is worth less than the product page.
      const searchLink = (u: string) => !u || /[?&](q|keywords)=/.test(u);
      setF((x) => ({
        ...x,
        name: !x.name.trim() || x.name === x.mpn ? p.description || x.name : x.name,
        mpn: x.mpn || p.mpn,
        manufacturer: x.manufacturer || p.manufacturer,
        package: x.package || p.package,
        label_text: x.label_text || p.label_text,
        datasheet_url: x.datasheet_url || p.datasheet_url,
        supplier_url: searchLink(x.supplier_url) && p.product_url ? p.product_url : x.supplier_url,
        description:
          x.description ||
          [p.category, p.supplier_part && `Mouser ${p.supplier_part}`].filter(Boolean).join(" · "),
      }));
      // The matching category, or the suggested new one in the "new category"
      // box, unless a category was already chosen.
      if (f.category_id === null && newCat === null) {
        if (p.category_id !== null) set("category_id", p.category_id);
        else if (p.new_category) setNewCat(p.new_category);
      }
      setPhotoUrl(p.image_url);
      setLookup("done");
    } catch (e) {
      setLookup(e instanceof ApiError && e.status === 404 ? "notFound" : e instanceof ApiError ? e : null);
    }
  }

  // A scanned bag is looked up as soon as the form opens.
  const lookedUp = useRef(false);
  useEffect(() => {
    if (prefill && meta?.part_lookup && !lookedUp.current) {
      lookedUp.current = true;
      lookUp(prefill.mpn);
    }
  });

  /** Finds or creates the category path "A/B/C" and returns its id. */
  async function ensureCategory(path: string): Promise<number | null> {
    let parent: number | null = null;
    let cats = categories.data ?? [];
    for (const part of path
      .split("/")
      .map((s) => s.trim())
      .filter(Boolean)) {
      const found = cats.find((c) => c.parent_id === parent && c.name.toLowerCase() === part.toLowerCase());
      if (found) {
        parent = found.id;
        continue;
      }
      const created: Category = await api<Category>("POST", "/api/categories", {
        name: part,
        parent_id: parent,
      });
      cats = [...cats, created];
      parent = created.id;
    }
    await qc.invalidateQueries({ queryKey: ["categories"] });
    return parent;
  }

  async function createCategory() {
    const name = newCat?.trim();
    if (!name) return;
    try {
      set("category_id", await ensureCategory(name));
      setNewCat(null);
    } catch (e) {
      setError(e);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { owner, ...fields } = f;
    const o = parseOwnerValue(owner);
    // A category still typed in the "new category" box (e.g. suggested by
    // the Mouser lookup) is created with the item.
    if (newCat?.trim()) {
      try {
        fields.category_id = await ensureCategory(newCat);
        setNewCat(null);
      } catch (err) {
        setError(err);
        setBusy(false);
        return;
      }
    }
    const body = {
      ...fields,
      version,
      min_stock: f.min_stock === "" ? null : Number(f.min_stock.replace(",", ".")),
      owner_project_id: o.project_id,
      owner_department_id: o.department_id,
    };
    try {
      const saved = item
        ? await api<Item>("PATCH", `/api/items/${item.id}`, body)
        : await api<Item>("POST", "/api/items", body);
      if (!item && photoUrl) {
        // Mouser's product photo; the item is fine without it.
        try {
          const img = await fetch(`/api/parts/image?url=${encodeURIComponent(photoUrl)}`);
          if (img.ok) await api("PUT", `/api/items/${saved.id}/photo`, await img.blob());
        } catch {
          // no photo
        }
      }
      if (!item && wantsAdd(add)) {
        try {
          await addToItem(saved, add);
        } catch (err) {
          // The item exists now; let them add stock from its page.
          qc.invalidateQueries();
          navigate(`/items/${saved.id}`, { replace: true });
          alert(t.form.stockNotAdded(errorMessage(err)));
          return;
        }
      }
      qc.invalidateQueries();
      navigate(`/items/${saved.id}`, { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const crumbs = item
    ? [
        { label: t.nav.items, to: "/items" },
        { label: item.name, to: `/items/${item.id}` },
      ]
    : [{ label: t.nav.items, to: "/items" }];

  return (
    <Page title={item ? t.form.editItem : t.form.newItem} crumbs={crumbs}>
      {prefill && (
        <div className="alert alert-info" style={{ maxWidth: 920, marginBottom: "1rem" }}>
          <ScanLine size={16} />
          <span>{t.form.fromBag(prefill.mpn)}</span>
        </div>
      )}
      <form onSubmit={submit} className="card" style={{ maxWidth: 920 }}>
        <Section title={t.form.basics} hint={t.form.basicsHint}>
          <label className="field">
            <span>{t.common.name}</span>
            <input
              value={f.name}
              onChange={(e) => set("name", e.target.value)}
              required
              placeholder={t.form.namePh}
              autoFocus={!item}
            />
          </label>
          <label className="field">
            <span>{t.form.labelText}</span>
            <input
              value={f.label_text}
              onChange={(e) => set("label_text", e.target.value)}
              placeholder={f.name || t.form.labelTextPh}
            />
            <span className="field-hint">{t.form.labelTextHint}</span>
          </label>
          <div className="field">
            <span className="field-label">{t.common.type}</span>
            <div className="segmented" role="radiogroup" aria-label={t.common.type}>
              {itemKinds.map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={f.kind === k}
                  className={f.kind === k ? "on" : ""}
                  onClick={() => set("kind", k)}
                >
                  {kindLabel(k)}
                </button>
              ))}
            </div>
            <span className="field-hint">{t.form.kindHelp[f.kind]}</span>
          </div>
          <div className="grid-2">
            <div className="field">
              <span className="field-label">{t.common.category}</span>
              {newCat === null ? (
                <select
                  value={f.category_id ?? ""}
                  onChange={(e) =>
                    e.target.value === "new"
                      ? setNewCat("")
                      : set("category_id", e.target.value ? Number(e.target.value) : null)
                  }
                  aria-label={t.common.category}
                >
                  <option value="">{t.form.noCategory}</option>
                  {[...catPaths.entries()]
                    .sort((a, b) => a[1].localeCompare(b[1]))
                    .map(([id, p]) => (
                      <option key={id} value={id}>
                        {p}
                      </option>
                    ))}
                  <option value="new">{t.form.newCategory}</option>
                </select>
              ) : (
                <div className="row" style={{ flexWrap: "nowrap" }}>
                  <input
                    autoFocus
                    value={newCat}
                    onChange={(e) => setNewCat(e.target.value)}
                    placeholder={t.form.categoryPh}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        createCategory();
                      }
                    }}
                    aria-label={t.form.newCategoryLabel}
                  />
                  <button type="button" className="btn" onClick={createCategory}>
                    <Plus size={15} /> {t.common.add}
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setNewCat(null)}>
                    {t.common.cancel}
                  </button>
                </div>
              )}
            </div>
            <label className="field">
              <span>{t.common.owner}</span>
              <OrgSelect value={f.owner} onChange={(v) => set("owner", v)} noneLabel={t.common.teamShared} />
            </label>
          </div>
        </Section>

        <Section title={t.form.identification} hint={t.form.identificationHint}>
          <div className="grid-2">
            <label className="field">
              <span>{t.form.manufacturer}</span>
              <input value={f.manufacturer} onChange={(e) => set("manufacturer", e.target.value)} />
            </label>
            <label className="field">
              <span>{t.form.mpn}</span>
              <input value={f.mpn} onChange={(e) => set("mpn", e.target.value)} className="mono" />
            </label>
          </div>
          {meta?.part_lookup && (
            <div className="row" style={{ gap: "0.75rem" }}>
              <button
                type="button"
                className="btn btn-sm"
                disabled={!f.mpn.trim() || lookup === "busy"}
                onClick={() => lookUp(f.mpn)}
              >
                <Download size={14} /> {lookup === "busy" ? t.form.lookingUp : t.form.lookUp}
              </button>
              <span className="small muted">
                {lookup === "done"
                  ? t.form.lookedUp
                  : lookup === "notFound"
                    ? t.form.lookupNotFound
                    : lookup instanceof ApiError
                      ? errorMessage(lookup)
                      : f.mpn.trim()
                        ? ""
                        : t.form.lookupHint}
              </span>
            </div>
          )}
          <label className="field">
            <span>{t.form.packageFootprint}</span>
            <input
              value={f.package}
              onChange={(e) => set("package", e.target.value)}
              className="mono"
              placeholder={t.form.packagePh}
            />
          </label>
        </Section>

        {!units && (
          <Section title={t.form.stock} hint={t.form.stockHint}>
            <div className="grid-2">
              <label className="field">
                <span>{t.common.unit}</span>
                <input value={f.unit} onChange={(e) => set("unit", e.target.value)} list="units" />
                <datalist id="units">
                  <option value="pcs" />
                  <option value="m" />
                  <option value="g" />
                  <option value="kg" />
                  <option value="ml" />
                  <option value="L" />
                </datalist>
              </label>
              <label className="field">
                <span>{t.form.warnBelow}</span>
                <input
                  inputMode="decimal"
                  value={f.min_stock}
                  onChange={(e) => set("min_stock", e.target.value)}
                  placeholder={t.form.noMinimum}
                />
              </label>
            </div>
          </Section>
        )}

        {f.kind === "hazmat" && (
          <Section title={t.form.safety} hint={t.form.safetyHint}>
            <div className="grid-2">
              <label className="field">
                <span>{t.item.hazard}</span>
                <input
                  value={f.hazard_class}
                  onChange={(e) => set("hazard_class", e.target.value)}
                  placeholder={t.form.hazardPh}
                />
              </label>
              <label className="field">
                <span>{t.form.storageNotes}</span>
                <input
                  value={f.storage_notes}
                  onChange={(e) => set("storage_notes", e.target.value)}
                  placeholder={t.form.storagePh}
                />
              </label>
            </div>
          </Section>
        )}

        <Section title={t.form.links}>
          <div className="grid-2">
            <label className="field">
              <span>{t.item.datasheetLink}</span>
              <input
                type="url"
                value={f.datasheet_url}
                onChange={(e) => set("datasheet_url", e.target.value)}
                placeholder="https://"
              />
            </label>
            <label className="field">
              <span>{t.form.supplierLink}</span>
              <input
                type="url"
                value={f.supplier_url}
                onChange={(e) => set("supplier_url", e.target.value)}
                placeholder="https://"
              />
            </label>
          </div>
          <label className="field">
            <span>{t.common.description}</span>
            <textarea rows={3} value={f.description} onChange={(e) => set("description", e.target.value)} />
          </label>
        </Section>

        {!item && (
          <Section title={t.form.putSome} hint={t.form.putSomeHint}>
            <AddFields units={units} unit={f.unit} v={add} set={setAdd} />
          </Section>
        )}

        {error !== null && (
          <div style={{ padding: "0 1.1rem 1rem" }}>
            <ErrorBox error={error} />
          </div>
        )}
        <div className="form-actions">
          <Link to={item ? `/items/${item.id}` : "/items"} className="btn btn-ghost">
            {t.common.cancel}
          </Link>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? t.common.saving : item ? t.form.saveChanges : t.form.createItem}
          </button>
        </div>
      </form>
    </Page>
  );
}
