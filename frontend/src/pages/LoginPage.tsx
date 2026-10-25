import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, TriangleAlert } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, get, type User } from "../api";
import { BrandMark, ErrorBox } from "../components/ui";
import { LangToggle, useT } from "../i18n";

interface Methods {
  google: boolean;
  dev: boolean;
  domain: string;
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"
      />
    </svg>
  );
}

export function LoginPage() {
  const [params] = useSearchParams();
  const next = params.get("next") || "/";
  const methods = useQuery({ queryKey: ["auth-methods"], queryFn: () => get<Methods>("/auth/methods") });
  const devUsers = useQuery({
    queryKey: ["dev-users"],
    queryFn: () => get<User[]>("/auth/dev/users"),
    enabled: !!methods.data?.dev,
  });
  const [email, setEmail] = useState("");
  const [error, setError] = useState<unknown>(params.get("error"));
  const navigate = useNavigate();
  const qc = useQueryClient();
  const t = useT();

  async function devLogin(addr: string, e?: FormEvent) {
    e?.preventDefault();
    try {
      await api("POST", "/auth/dev/login", { email: addr });
      await qc.invalidateQueries();
      navigate(next, { replace: true });
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="login">
      <div className="card login-card">
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
          <div className="brand">
            <BrandMark />
            <span>
              INVENTARIUS
              <small>Porto Space Team</small>
            </span>
          </div>
          <LangToggle />
        </div>
        <div>
          <h1 style={{ fontSize: "1.4rem" }}>{t.login.signIn}</h1>
          <p className="muted small" style={{ marginTop: "0.3rem" }}>
            {t.login.tagline}
          </p>
        </div>
        <ErrorBox error={error} />
        {methods.data?.google && (
          <>
            <a className="btn btn-lg btn-block" href={`/auth/google?next=${encodeURIComponent(next)}`}>
              <GoogleLogo /> {t.login.google}
            </a>
            <p className="tiny muted center">{t.login.accountHint(methods.data.domain)}</p>
          </>
        )}
        {methods.data?.dev && (
          <>
            {methods.data.google && <div className="divider">{t.login.development}</div>}
            <div className="alert alert-warn" style={{ fontSize: "0.82rem" }}>
              <TriangleAlert size={15} />
              <span>{t.login.devWarning}</span>
            </div>
            {devUsers.data && devUsers.data.length > 0 && (
              <div className="list card" style={{ boxShadow: "none" }}>
                {devUsers.data.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    className="list-row"
                    style={{
                      border: "none",
                      background: "none",
                      font: "inherit",
                      width: "100%",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                    onClick={() => devLogin(u.email)}
                  >
                    <span className="avatar">{u.name.slice(0, 1).toUpperCase()}</span>
                    <div className="row-main">
                      <div className="row-title">{u.name}</div>
                      <div className="row-meta">
                        <span>{u.email}</span>
                      </div>
                    </div>
                    <ArrowRight size={16} className="faint" />
                  </button>
                ))}
              </div>
            )}
            <form onSubmit={(e) => devLogin(email, e)} className="row" style={{ flexWrap: "nowrap" }}>
              <input
                type="email"
                placeholder={`someone@${methods.data.domain}`}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                aria-label={t.login.email}
              />
              <button type="submit" className="btn btn-primary">
                {t.login.signIn}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
