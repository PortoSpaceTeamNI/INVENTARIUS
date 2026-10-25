import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { api, get, type Role, type User } from "../api";
import { Card, Empty, ErrorBox, Loading, Page, Sheet, useToast } from "../components/ui";
import { useT } from "../i18n";
import { errorMessage, useMe, useMeta } from "../lib";

const roles: Role[] = ["member", "dept_lead", "admin"];

export function UsersPage() {
  const users = useQuery({ queryKey: ["users"], queryFn: () => get<User[]>("/api/users") });
  const { data: me } = useMe();
  const { data: meta } = useMeta();
  const [editing, setEditing] = useState<User | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const t = useT();

  async function update(u: User, patch: Partial<Pick<User, "role" | "active" | "department_ids">>) {
    try {
      await api("PATCH", `/api/users/${u.id}`, patch);
      await qc.invalidateQueries({ queryKey: ["users"] });
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  if (me?.role !== "admin")
    return (
      <Page title={t.users.title}>
        <Card>
          <Empty icon={<ShieldCheck size={20} />} title={t.users.adminsOnly}>
            {t.users.adminsOnlyHint}
          </Empty>
        </Card>
      </Page>
    );
  if (users.isPending) return <Loading />;

  const deptNames = (ids: number[]) =>
    ids
      .map((id) => {
        const d = meta?.departments.find((x) => x.id === id);
        const p = d && meta?.projects.find((x) => x.id === d.project_id);
        return d && p ? `${p.code.slice(0, 3)} · ${d.name}` : "";
      })
      .filter(Boolean);
  const current = editing && users.data?.find((u) => u.id === editing.id);

  return (
    <Page title={t.users.title} subtitle={t.users.subtitle}>
      <ErrorBox error={users.error} />
      <Card count={users.data?.length} title={t.users.members}>
        <div className="list">
          {users.data?.map((u) => (
            <div key={u.id} className="list-row" style={{ opacity: u.active ? 1 : 0.55, flexWrap: "wrap" }}>
              <span className="avatar">
                {u.picture ? (
                  <img src={u.picture} alt="" referrerPolicy="no-referrer" />
                ) : (
                  u.name.slice(0, 1).toUpperCase()
                )}
              </span>
              <div className="row-main" style={{ minWidth: 200 }}>
                <div className="row-title">
                  {u.name}
                  {u.id === me.id && (
                    <span className="badge badge-info" style={{ marginLeft: 6 }}>
                      {t.common.you}
                    </span>
                  )}
                  {!u.active && (
                    <span className="badge" style={{ marginLeft: 6 }}>
                      {t.users.disabled}
                    </span>
                  )}
                </div>
                <div className="row-meta">
                  <span>{u.email}</span>
                </div>
                <div className="tags" style={{ marginTop: "0.35rem" }}>
                  {deptNames(u.department_ids).map((n) => (
                    <span key={n} className="badge">
                      {n}
                    </span>
                  ))}
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ height: 24 }}
                    onClick={() => setEditing(u)}
                  >
                    <Pencil size={12} /> {t.users.departments}
                  </button>
                </div>
              </div>
              <div className="row" style={{ flexWrap: "nowrap" }}>
                <select
                  value={u.role}
                  onChange={(e) => update(u, { role: e.target.value as Role })}
                  disabled={u.id === me.id}
                  aria-label={t.users.roleOf(u.name)}
                  style={{ width: "auto" }}
                >
                  {roles.map((r) => (
                    <option key={r} value={r}>
                      {t.role[r]}
                    </option>
                  ))}
                </select>
                <label className="check small" title={t.users.canSignIn}>
                  <input
                    type="checkbox"
                    checked={u.active}
                    disabled={u.id === me.id}
                    onChange={(e) => update(u, { active: e.target.checked })}
                  />
                  {t.users.active}
                </label>
              </div>
            </div>
          ))}
        </div>
        <div className="card-footer muted">{t.users.footer}</div>
      </Card>

      {current && (
        <Sheet open onClose={() => setEditing(null)} title={t.users.departments} subtitle={current.name}>
          <div className="stack">
            {meta?.projects.map((p) => (
              <div key={p.id} className="stack-sm">
                <h3>{p.name}</h3>
                <div className="chips">
                  {meta.departments
                    .filter((d) => d.project_id === p.id)
                    .map((d) => {
                      const on = current.department_ids.includes(d.id);
                      return (
                        <button
                          key={d.id}
                          type="button"
                          className={`chip ${on ? "on" : ""}`}
                          onClick={() =>
                            update(current, {
                              department_ids: on
                                ? current.department_ids.filter((x) => x !== d.id)
                                : [...current.department_ids, d.id],
                            })
                          }
                        >
                          {d.name}
                        </button>
                      );
                    })}
                </div>
              </div>
            ))}
            <button type="button" className="btn btn-primary btn-block" onClick={() => setEditing(null)}>
              {t.common.done}
            </button>
          </div>
        </Sheet>
      )}
    </Page>
  );
}
