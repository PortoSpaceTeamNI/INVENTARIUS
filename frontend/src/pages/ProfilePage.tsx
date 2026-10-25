import { useQueryClient } from "@tanstack/react-query";
import { FileUp, Languages, LogOut, Printer, Users } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { Card, Page, useToast } from "../components/ui";
import { LangToggle, useT } from "../i18n";
import { errorMessage, useMe, useMeta } from "../lib";

export function ProfilePage() {
  const { data: me } = useMe();
  const { data: meta } = useMeta();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const t = useT();
  if (!me || !meta) return null;

  async function toggle(id: number) {
    if (!me) return;
    const ids = me.department_ids.includes(id)
      ? me.department_ids.filter((x) => x !== id)
      : [...me.department_ids, id];
    try {
      await api("PUT", "/api/me/departments", { department_ids: ids });
      qc.invalidateQueries({ queryKey: ["me"] });
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  async function logout() {
    await api("POST", "/auth/logout");
    qc.clear();
    navigate("/login", { replace: true });
  }

  return (
    <Page
      title={
        <span className="row" style={{ gap: "0.85rem", flexWrap: "nowrap" }}>
          <span className="avatar" style={{ width: 52, height: 52, fontSize: "1.2rem" }}>
            {me.picture ? (
              <img src={me.picture} alt="" referrerPolicy="no-referrer" />
            ) : (
              me.name.slice(0, 1).toUpperCase()
            )}
          </span>
          <span>
            {me.name}
            <span className="page-subtitle" style={{ display: "block", marginTop: 2 }}>
              {me.email}
            </span>
          </span>
        </span>
      }
      actions={
        <>
          <span className="badge badge-info">{t.role[me.role]}</span>
          <button type="button" className="btn" onClick={logout}>
            <LogOut size={15} /> {t.profile.signOut}
          </button>
        </>
      }
    >
      <div className="layout-2">
        <Card title={t.profile.myDepts}>
          <div className="card-pad stack">
            <p className="small muted">{t.profile.deptsHint}</p>
            {meta.projects.map((p) => (
              <div key={p.id} className="stack-sm">
                <h3>{p.name}</h3>
                <div className="chips">
                  {meta.departments
                    .filter((d) => d.project_id === p.id)
                    .map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        className={`chip ${me.department_ids.includes(d.id) ? "on" : ""}`}
                        onClick={() => toggle(d.id)}
                        aria-pressed={me.department_ids.includes(d.id)}
                      >
                        {d.name}
                      </button>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
        <div className="stack" style={{ gap: "1.25rem" }}>
          <Card title={t.profile.language}>
            <div className="card-pad row" style={{ justifyContent: "space-between" }}>
              <span className="row small muted" style={{ gap: "0.5rem" }}>
                <Languages size={16} /> {t.profile.languageHint}
              </span>
              <LangToggle />
            </div>
          </Card>
          <Card title={t.profile.shortcuts}>
            <div className="list">
              <Link to="/print" className="list-row">
                <span className="row-icon kind-tool">
                  <Printer size={16} />
                </span>
                <div className="row-main">
                  <div className="row-title">{t.profile.labelsPrinter}</div>
                </div>
              </Link>
              <Link to="/import" className="list-row">
                <span className="row-icon kind-flight_hw">
                  <FileUp size={16} />
                </span>
                <div className="row-main">
                  <div className="row-title">{t.profile.importSheet}</div>
                </div>
              </Link>
              {me.role === "admin" && (
                <Link to="/users" className="list-row">
                  <span className="row-icon kind-consumable">
                    <Users size={16} />
                  </span>
                  <div className="row-main">
                    <div className="row-title">{t.profile.people}</div>
                  </div>
                </Link>
              )}
            </div>
          </Card>
        </div>
      </div>
    </Page>
  );
}
