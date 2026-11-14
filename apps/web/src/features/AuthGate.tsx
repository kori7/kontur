import { useEffect, useState, type ReactNode } from "react";
import { Loader2, LogIn, ShieldCheck } from "lucide-react";
import { formatCopy, request } from "../api";
import type { Me, User } from "../types";

/** Shows the sign-in form until there is a user; with sign-in switched off, passes the demo user through. */
export function AuthGate({ children }: { children: (user: User, signOut: () => void) => ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [failed, setFailed] = useState("");
  const load = () =>
    request<Me>("/auth/me")
      .then((answer) => {
        setMe(answer);
        setFailed("");
      })
      .catch((cause) => setFailed((cause as Error).message));
  useEffect(() => {
    void load();
    const signedOut = () => setMe((current) => (current ? { ...current, user: null } : current));
    window.addEventListener("kontur-signed-out", signedOut);
    return () => window.removeEventListener("kontur-signed-out", signedOut);
  }, []);
  async function signOut() {
    await request("/auth/logout", {}).catch(() => undefined);
    await load();
  }
  if (failed) {
    return (
      <div className="loading-screen">
        <h2>Сервер недоступен</h2>
        <p className="support-copy">{formatCopy(failed)}</p>
        <button className="button primary" onClick={() => void load()}>Повторить</button>
      </div>
    );
  }
  if (!me) {
    return (
      <div className="loading-screen">
        <Loader2 className="spin" size={28} />
      </div>
    );
  }
  if (!me.user) return <SignIn setup={me.setup_required} onDone={(user) => setMe({ ...me, setup_required: false, user })} />;
  return <>{children(me.user, () => void signOut())}</>;
}

function SignIn({ setup, onDone }: { setup: boolean; onDone: (user: User) => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const user = await request<User>(setup ? "/auth/setup" : "/auth/login",
        setup ? { email, name, password } : { email, password });
      onDone(user);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="sign-in">
      <form className="sign-in-card" onSubmit={submit}>
        <div className="sign-in-brand">
          <span className="sign-in-wordmark">КОНТУР</span>
          <span className="support-copy">Осмотр оборудования</span>
        </div>
        <h1>{setup ? "Первый запуск: администратор" : "Вход"}</h1>
        {setup && (
          <p className="support-copy">
            Учётных записей ещё нет. Создайте администратора — он добавит инженеров и мастеров
          </p>
        )}
        {setup && (
          <label className="field">
            Имя и фамилия
            <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required />
          </label>
        )}
        <label className="field">
          Почта
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)}
            autoComplete="username" inputMode="email" required />
        </label>
        <label className="field">
          Пароль
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)}
            autoComplete={setup ? "new-password" : "current-password"} minLength={setup ? 8 : undefined} required />
        </label>
        {error && <p className="camera-message camera-error support-copy" role="alert">{formatCopy(error)}</p>}
        <button className="button primary sign-in-submit" disabled={busy}>
          {busy ? <Loader2 size={18} className="spin" /> : setup ? <ShieldCheck size={18} /> : <LogIn size={18} />}
          {setup ? "Создать и войти" : "Войти"}
        </button>
        <p className="support-copy sign-in-note">Работает только в локальной сети предприятия</p>
      </form>
    </main>
  );
}
