import { useEffect, useState } from "react";
import { KeyRound, UserPlus } from "lucide-react";
import { formatCopy, request, send } from "../api";
import type { Role, User } from "../types";

const ROLE_NAMES: Record<Role, string> = { engineer: "Инженер", master: "Мастер", admin: "Администратор" };

/** Administrator's list of accounts: add a person, change a role, reset a password, switch an account off. */
export function UsersPanel({ me }: { me: User }) {
  const [users, setUsers] = useState<User[]>([]);
  const [form, setForm] = useState({ email: "", name: "", role: "engineer" as Role, password: "" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  // The account whose password is being reset, and the new temporary password typed for it.
  const [reset, setReset] = useState<{ id: string; password: string } | null>(null);
  const load = () => request<User[]>("/users").then(setUsers).catch((cause) => setError((cause as Error).message));
  useEffect(() => {
    void load();
  }, []);
  async function add(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const created = await request<User>("/users", form);
      setMessage(`Добавлен: ${created.name}, ${created.role_name.toLowerCase()}. Передайте пароль лично`);
      setForm({ email: "", name: "", role: "engineer", password: "" });
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  async function change(user: User, update: { role?: Role; active?: boolean; password?: string }) {
    setError("");
    if (update.role && !window.confirm(`Сменить роль: ${user.name} — ${ROLE_NAMES[update.role].toLowerCase()}?`)) {
      await load();
      return;
    }
    try {
      await send<User>(`/users/${user.id}`, "PATCH", update);
      if (update.password) {
        setReset(null);
        setMessage(`Пароль для ${user.name} сменён. Передайте его лично`);
      }
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  return (
    <div className="users-panel">
      <ul className="users-list">
        {users.map((user) => (
          <li key={user.id} className={user.active ? "" : "inactive"}>
            <div>
              <strong>{user.name}</strong>
              <span className="support-copy">{user.email}{user.active ? "" : " · отключён"}</span>
            </div>
            <select aria-label={`Роль: ${user.name}`} value={user.role} disabled={user.id === me.id}
              onChange={(event) => void change(user, { role: event.target.value as Role })}>
              {Object.entries(ROLE_NAMES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
            {user.id !== me.id && (
              <button className="button secondary" onClick={() => void change(user, { active: !user.active })}>
                {user.active ? "Отключить" : "Включить"}
              </button>
            )}
            <button className="button secondary" aria-label={`Новый пароль: ${user.name}`}
              onClick={() => setReset(reset?.id === user.id ? null : { id: user.id, password: "" })}>
              <KeyRound size={16} />Пароль
            </button>
            {reset?.id === user.id && (
              <form className="users-reset" onSubmit={(event) => {
                event.preventDefault();
                void change(user, { password: reset.password });
              }}>
                <label className="field">Новый временный пароль
                  <input type="password" minLength={8} autoComplete="new-password" value={reset.password} required
                    onChange={(event) => setReset({ id: user.id, password: event.target.value })} />
                </label>
                <button className="button primary">Сохранить</button>
              </form>
            )}
          </li>
        ))}
      </ul>
      <form className="users-form" onSubmit={add}>
        <h3>Новая учётная запись</h3>
        <label className="field">Имя и фамилия
          <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
        </label>
        <label className="field">Почта
          <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required />
        </label>
        <label className="field">Роль
          <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as Role })}>
            {Object.entries(ROLE_NAMES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <label className="field">Временный пароль
          <input type="password" minLength={8} autoComplete="new-password" value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })} required />
        </label>
        <button className="button primary"><UserPlus size={18} />Добавить</button>
      </form>
      {message && <p className="camera-message support-copy" role="status">{formatCopy(message)}</p>}
      {error && <p className="camera-message camera-error support-copy" role="alert">{formatCopy(error)}</p>}
    </div>
  );
}
