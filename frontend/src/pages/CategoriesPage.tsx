import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Tag,
  Trash2,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Category, get } from "../api";
import { CategorySelect } from "../components/pickers";
import { Card, Empty, ErrorBox, Loading, Menu, Page, Sheet, useToast } from "../components/ui";
import { useT } from "../i18n";
import { errorMessage, useMe } from "../lib";

interface Count {
  id: number;
  item_count: number;
}

const byName = (a: Category, b: Category) => a.name.localeCompare(b.name, undefined, { numeric: true });

/** Items directly in each category, and in each category including its subcategories. */
function useCategoryTree(cats: Category[] | undefined) {
  const counts = useQuery({
    queryKey: ["category-counts"],
    queryFn: () => get<Count[]>("/api/categories/counts"),
  });
  return useMemo(() => {
    const direct = new Map((counts.data ?? []).map((c) => [c.id, c.item_count]));
    const kids = new Map<number | null, Category[]>();
    for (const c of cats ?? []) kids.set(c.parent_id, [...(kids.get(c.parent_id) ?? []), c]);
    const total = new Map<number, number>();
    const sum = (id: number, depth = 0): number => {
      const known = total.get(id);
      if (known !== undefined) return known;
      let n = direct.get(id) ?? 0;
      if (depth < 32) for (const k of kids.get(id) ?? []) n += sum(k.id, depth + 1);
      total.set(id, n);
      return n;
    };
    for (const c of cats ?? []) sum(c.id);
    return { direct, total, kids };
  }, [counts.data, cats]);
}

/** What the sheet is for: a new category (under parent), or editing one. */
type Editing = { parent: number | null } | { cat: Category };

export function CategoriesPage() {
  const {
    data: cats,
    isPending,
    error,
  } = useQuery({
    queryKey: ["categories"],
    queryFn: () => get<Category[]>("/api/categories"),
  });
  const { direct, total, kids } = useCategoryTree(cats);
  const { data: me } = useMe();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<Set<number>>(new Set());
  const qc = useQueryClient();
  const toast = useToast();
  const t = useT();

  // Categories matching the filter, plus their parents so they stay visible.
  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f || !cats) return null;
    const byId = new Map(cats.map((c) => [c.id, c]));
    const keep = new Set<number>();
    for (const c of cats)
      if (c.name.toLowerCase().includes(f))
        for (
          let p: Category | undefined = c, d = 0;
          p && d < 32;
          p = p.parent_id ? byId.get(p.parent_id) : undefined, d++
        )
          keep.add(p.id);
    return keep;
  }, [filter, cats]);

  const roots = [...(kids.get(null) ?? [])].sort(byName);
  const toggle = (id: number) => {
    const next = new Set(open);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpen(next);
  };
  const items = (cats ?? []).reduce((n, c) => n + (direct.get(c.id) ?? 0), 0);

  async function remove(c: Category) {
    const subs = kids.get(c.id)?.length ?? 0;
    const n = direct.get(c.id) ?? 0;
    if (subs || n) {
      toast(t.cats.notEmpty(subs, n), "error");
      return;
    }
    if (!confirm(t.cats.confirmDelete(c.name))) return;
    try {
      await api("DELETE", `/api/categories/${c.id}`);
      await qc.invalidateQueries({ queryKey: ["categories"] });
      qc.invalidateQueries({ queryKey: ["category-counts"] });
      toast(t.cats.deleted(c.name));
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  const row = {
    kids,
    total,
    isOpen: (id: number) => (visible ? visible.has(id) : open.has(id)),
    visible,
    toggle,
    onAdd: (c: Category) => setEditing({ parent: c.id }),
    onEdit: (c: Category) => setEditing({ cat: c }),
    onDelete: me?.role === "admin" ? remove : undefined,
  };

  return (
    <Page
      title={t.cats.title}
      subtitle={cats && t.cats.subtitle(cats.length, items)}
      actions={
        <button type="button" className="btn btn-primary" onClick={() => setEditing({ parent: null })}>
          <Plus size={16} /> {t.cats.newCategory}
        </button>
      }
    >
      <ErrorBox error={error} />
      <div className="toolbar">
        <div className="search-input">
          <Search size={16} />
          <input
            type="search"
            placeholder={t.cats.find}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <button type="button" className="btn" onClick={() => setOpen(new Set(cats?.map((c) => c.id)))}>
          <ChevronsUpDown size={15} /> {t.locs.expandAll}
        </button>
        <button type="button" className="btn" onClick={() => setOpen(new Set())}>
          <ChevronsDownUp size={15} /> {t.locs.collapse}
        </button>
      </div>
      {isPending ? (
        <Loading rows={6} />
      ) : roots.length === 0 ? (
        <Card>
          <Empty
            icon={<Tag size={20} />}
            title={t.cats.noneYet}
            action={
              <button type="button" className="btn btn-primary" onClick={() => setEditing({ parent: null })}>
                <Plus size={15} /> {t.cats.newCategory}
              </button>
            }
          >
            {t.cats.noneHint}
          </Empty>
        </Card>
      ) : (
        <Card>
          <ul className="tree">
            {roots
              .filter((c) => !visible || visible.has(c.id))
              .map((c) => (
                <TreeNode key={c.id} cat={c} depth={0} {...row} />
              ))}
          </ul>
        </Card>
      )}
      <CategorySheet editing={editing} cats={cats} onClose={() => setEditing(null)} />
    </Page>
  );
}

function TreeNode(props: {
  cat: Category;
  kids: Map<number | null, Category[]>;
  total: Map<number, number>;
  isOpen: (id: number) => boolean;
  visible: Set<number> | null;
  toggle: (id: number) => void;
  onAdd: (c: Category) => void;
  onEdit: (c: Category) => void;
  onDelete?: (c: Category) => void;
  depth: number;
}) {
  const { cat, onDelete } = props;
  const children = (props.kids.get(cat.id) ?? [])
    .filter((k) => !props.visible || props.visible.has(k.id))
    .sort(byName);
  const open = props.isOpen(cat.id);
  const n = props.total.get(cat.id) ?? 0;
  const t = useT();
  return (
    <li>
      <div className="tree-row">
        <button
          type="button"
          className={`tree-toggle ${open ? "open" : ""} ${children.length ? "" : "leaf"}`}
          onClick={() => props.toggle(cat.id)}
          aria-label={open ? t.locs.collapse : t.locs.expand}
          aria-expanded={open}
        >
          <ChevronRight size={16} />
        </button>
        <Link to={`/items?category=${cat.id}`} title={t.cats.showItems}>
          <Tag size={15} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {cat.name}
          </span>
        </Link>
        <span className="tree-meta">
          {children.length > 0 && t.cats.nSub(children.length)}
          {t.items.count(n)}
        </span>
        <Menu
          label={t.common.moreActions}
          trigger={<MoreHorizontal size={16} />}
          size="sm"
          items={[
            { label: t.cats.addSub, icon: <FolderPlus size={15} />, onSelect: () => props.onAdd(cat) },
            { label: t.cats.edit, icon: <Pencil size={15} />, onSelect: () => props.onEdit(cat) },
            onDelete && {
              label: t.cats.delete,
              icon: <Trash2 size={15} />,
              onSelect: () => onDelete(cat),
              danger: true,
              separatorBefore: true,
            },
          ]}
        />
      </div>
      {open && children.length > 0 && props.depth < 20 && (
        <ul>
          {children.map((k) => (
            <TreeNode key={k.id} {...props} cat={k} depth={props.depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

function CategorySheet(props: {
  editing: Editing | null;
  cats: Category[] | undefined;
  onClose: () => void;
}) {
  const e = props.editing;
  const cat = e && "cat" in e ? e.cat : null;
  const [name, setName] = useState("");
  const [parent, setParent] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const t = useT();

  // Each time it opens, start from the category being edited, or empty
  // under the parent it was opened from.
  useEffect(() => {
    if (!e) return;
    setName("cat" in e ? e.cat.name : "");
    setParent("cat" in e ? e.cat.parent_id : e.parent);
    setError(null);
  }, [e]);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setBusy(true);
    try {
      const body = { name, parent_id: parent };
      // cat is the snapshot taken when the sheet opened, so its version is
      // the one the edit started from.
      if (cat) await api("PATCH", `/api/categories/${cat.id}`, { ...body, version: cat.version });
      else await api("POST", "/api/categories", body);
      await qc.invalidateQueries({ queryKey: ["categories"] });
      qc.invalidateQueries({ queryKey: ["category-counts"] });
      toast(cat ? t.cats.saved(name.trim()) : t.cats.created(name.trim()));
      props.onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={e !== null}
      onClose={props.onClose}
      title={cat ? t.cats.edit : parent === null ? t.cats.newCategory : t.cats.addSub}
      subtitle={cat ? t.cats.editSubtitle : t.cats.newSubtitle}
    >
      <form onSubmit={submit} className="form">
        <label className="field">
          <span>{t.common.name}</span>
          <input
            value={name}
            onChange={(ev) => setName(ev.target.value)}
            placeholder={t.cats.namePh}
            required
            autoFocus
          />
        </label>
        <label className="field" htmlFor="category-parent">
          <span>{t.common.inside}</span>
          <CategorySelect
            id="category-parent"
            cats={props.cats}
            value={parent}
            onChange={setParent}
            emptyLabel={t.cats.topLevel}
            exclude={cat?.id}
          />
        </label>
        <ErrorBox error={error} />
        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>
          {busy ? t.common.saving : cat ? t.common.save : t.cats.create}
        </button>
      </form>
    </Sheet>
  );
}
