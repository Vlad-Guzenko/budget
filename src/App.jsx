import React, { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "./supabase.js";

// ---------- palette (instrument cluster) ----------
const C = {
  bg: "#101215", surface: "#191C22", surface2: "#1F232B", border: "#282D36",
  text: "#F0F2F5", muted: "#7C838E", blue: "#2F80FF",
  green: "#23C87A", amber: "#FFB020", red: "#FF5A52",
};
const mono = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
const sans = "'Inter', system-ui, -apple-system, sans-serif";

const DEFAULT_CONFIG = {
  livingBudget: 800, totalDays: 45, startISO: "2026-07-15", baseSavings: 4039.19,
};

// ---------- date helpers ----------
const pad = (n) => String(n).padStart(2, "0");
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const dateFromISO = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const daysBetween = (a, b) => Math.round((dateFromISO(b) - dateFromISO(a)) / 86400000);
const addDays = (iso, n) => {
  const d = dateFromISO(iso); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const RU_MONTHS = ["янв","фев","мар","апр","мая","июн","июл","авг","сен","окт","ноя","дек"];
const prettyDate = (iso) => { const d = dateFromISO(iso); return `${d.getDate()} ${RU_MONTHS[d.getMonth()]}`; };
const eur = (v) => (v < 0 ? "-" : "") + Math.abs(v).toFixed(2).replace(".", ",") + " €";

// =====================================================================
export default function App() {
  const [session, setSession] = useState(undefined); // undefined=loading, null=logged out

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (session === undefined) return <Splash />;
  if (session === null) return <Auth />;
  return <Tracker session={session} />;
}

// ---------------------------------------------------------------------
function Splash() {
  return (
    <div style={{ ...wrap, alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
      <div style={{ color: C.muted, fontFamily: mono }}>Загрузка…</div>
    </div>
  );
}

// ---------------------------------------------------------------------
function Auth() {
  const [mode, setMode] = useState("login"); // login | signup
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const submit = async () => {
    setBusy(true); setMsg("");
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMsg("Проверь почту для подтверждения (если включено), затем войди.");
      }
    } catch (e) {
      setMsg(e.message || "Ошибка");
    } finally { setBusy(false); }
  };

  return (
    <div style={{ ...wrap, minHeight: "100vh", justifyContent: "center" }}>
      <div style={{ marginBottom: 22, textAlign: "center" }}>
        <div style={{ fontSize: 34 }}>🏍️</div>
        <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>Мотофонд</div>
        <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>дневной бюджет до зарплаты</div>
      </div>
      <div style={panel}>
        <input type="email" placeholder="e-mail" value={email} autoCapitalize="none"
          onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
        <input type="password" placeholder="пароль" value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          style={{ ...inputStyle, marginTop: 10 }} />
        <button disabled={busy} onClick={submit} style={{ ...primaryBtn, width: "100%", marginTop: 14, padding: "13px" }}>
          {busy ? "…" : mode === "login" ? "Войти" : "Зарегистрироваться"}
        </button>
        {msg && <div style={{ color: C.amber, fontSize: 12, marginTop: 10 }}>{msg}</div>}
        <button onClick={() => { setMode(mode === "login" ? "signup" : "login"); setMsg(""); }}
          style={{ color: C.blue, fontSize: 13, marginTop: 14, background: "none", width: "100%" }}>
          {mode === "login" ? "Нет аккаунта? Создать" : "Уже есть аккаунт? Войти"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
function Tracker({ session }) {
  const uid = session.user.id;
  const [loaded, setLoaded] = useState(false);
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [entries, setEntries] = useState([]);
  const [input, setInput] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [draft, setDraft] = useState(DEFAULT_CONFIG);
  const [saving, setSaving] = useState(false);

  const mapConfig = (row) => ({
    livingBudget: Number(row.living_budget), totalDays: row.total_days,
    startISO: row.start_date, baseSavings: Number(row.base_savings),
  });

  const load = useCallback(async () => {
    // config
    const { data: cfg } = await supabase.from("config").select("*").eq("user_id", uid).maybeSingle();
    if (cfg) setConfig(mapConfig(cfg));
    else {
      await supabase.from("config").insert({
        user_id: uid, living_budget: DEFAULT_CONFIG.livingBudget,
        total_days: DEFAULT_CONFIG.totalDays, start_date: DEFAULT_CONFIG.startISO,
        base_savings: DEFAULT_CONFIG.baseSavings,
      });
      setConfig(DEFAULT_CONFIG);
    }
    // entries
    const { data: rows } = await supabase.from("entries").select("*").eq("user_id", uid).order("created_at", { ascending: false });
    setEntries((rows ?? []).map((r) => ({ id: r.id, date: r.spent_on, amount: Number(r.amount) })));
    setLoaded(true);
  }, [uid]);

  useEffect(() => { load(); }, [load]);

  // ----- math -----
  const m = useMemo(() => {
    const today = todayStr();
    const idxRaw = daysBetween(config.startISO, today);
    const todayIndex = Math.max(0, Math.min(idxRaw, config.totalDays - 1));
    const daysRemaining = Math.max(1, config.totalDays - todayIndex);
    const completedDays = todayIndex;

    const spentToday = entries.filter((e) => e.date === today).reduce((s, e) => s + e.amount, 0);
    const spentBeforeToday = entries.filter((e) => e.date < today).reduce((s, e) => s + e.amount, 0);
    const totalSpent = spentBeforeToday + spentToday;

    const remainingBudget = config.livingBudget - totalSpent;
    const allowanceToday = (config.livingBudget - spentBeforeToday) / daysRemaining;
    const leftToday = allowanceToday - spentToday;

    let projectedTotal;
    if (completedDays >= 1) {
      const avg = spentBeforeToday / completedDays;
      projectedTotal = spentBeforeToday + avg * daysRemaining;
    } else projectedTotal = config.livingBudget;
    const projectedSavings = config.baseSavings + (config.livingBudget - projectedTotal);

    const ratio = allowanceToday > 0 ? spentToday / allowanceToday : 0;
    const status = ratio > 1 ? "red" : ratio > 0.75 ? "amber" : "green";
    const endISO = addDays(config.startISO, config.totalDays - 1);

    return { today, daysRemaining, spentToday, totalSpent, remainingBudget,
      allowanceToday, leftToday, projectedSavings, projectedTotal, ratio, status, endISO };
  }, [config, entries]);

  const statusColor = { green: C.green, amber: C.amber, red: C.red }[m.status];

  const addSpend = async (val) => {
    const n = parseFloat(String(val).replace(",", "."));
    if (!isFinite(n) || n <= 0) return;
    setInput("");
    const optimistic = { id: "tmp-" + Date.now(), date: todayStr(), amount: n };
    setEntries((prev) => [optimistic, ...prev]);
    const { data, error } = await supabase.from("entries")
      .insert({ user_id: uid, spent_on: optimistic.date, amount: n }).select().single();
    if (error) { setEntries((prev) => prev.filter((e) => e.id !== optimistic.id)); return; }
    setEntries((prev) => prev.map((e) => e.id === optimistic.id
      ? { id: data.id, date: data.spent_on, amount: Number(data.amount) } : e));
  };

  const removeEntry = async (id) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    await supabase.from("entries").delete().eq("id", id);
  };

  const openSettings = () => { setDraft(config); setShowSettings(true); };
  const saveSettings = async () => {
    setSaving(true);
    const clean = {
      livingBudget: parseFloat(String(draft.livingBudget).replace(",", ".")) || DEFAULT_CONFIG.livingBudget,
      totalDays: parseInt(draft.totalDays) || DEFAULT_CONFIG.totalDays,
      baseSavings: parseFloat(String(draft.baseSavings).replace(",", ".")) || DEFAULT_CONFIG.baseSavings,
      startISO: draft.startISO || DEFAULT_CONFIG.startISO,
    };
    setConfig(clean);
    await supabase.from("config").upsert({
      user_id: uid, living_budget: clean.livingBudget, total_days: clean.totalDays,
      start_date: clean.startISO, base_savings: clean.baseSavings, updated_at: new Date().toISOString(),
    });
    setSaving(false); setShowSettings(false);
  };

  const todayEntries = entries.filter((e) => e.date === m.today);
  const pastByDay = useMemo(() => {
    const map = {};
    entries.filter((e) => e.date !== m.today).forEach((e) => { map[e.date] = (map[e.date] || 0) + e.amount; });
    return Object.entries(map).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [entries, m.today]);

  if (!loaded) return <Splash />;

  return (
    <div style={wrap}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: 2, color: C.muted, textTransform: "uppercase" }}>Бюджет до зарплаты</div>
          <div style={{ fontSize: 13, marginTop: 3 }}>
            до {prettyDate(m.endISO)} · осталось <b style={{ color: C.blue }}>{m.daysRemaining} дн.</b>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={openSettings} style={iconBtn} aria-label="Настройки">⚙︎</button>
          <button onClick={() => supabase.auth.signOut()} style={iconBtn} aria-label="Выйти">⏻</button>
        </div>
      </div>

      {/* HERO */}
      <div style={{ ...panel, padding: "22px 20px 20px" }}>
        <div style={label}>Осталось на сегодня</div>
        <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 52, lineHeight: 1.05,
          color: m.leftToday < 0 ? C.red : C.text, marginTop: 6, letterSpacing: -1 }}>
          {eur(m.leftToday)}
        </div>
        <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>
          из {eur(m.allowanceToday)} на день · потрачено {eur(m.spentToday)}
        </div>
        <div style={{ marginTop: 16, height: 12, background: C.surface2, borderRadius: 20, overflow: "hidden", border: `1px solid ${C.border}` }}>
          <div style={{ height: "100%", width: `${Math.min(m.ratio, 1) * 100}%`, background: statusColor,
            borderRadius: 20, transition: "width .5s ease", animation: "fillbar .6s ease" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 7, fontSize: 11, fontFamily: mono, color: C.muted }}>
          <span>0 €</span>
          <span style={{ color: statusColor }}>
            {m.status === "red" ? "перебор за день" : m.status === "amber" ? "почти лимит" : "в норме"}
          </span>
          <span>{eur(m.allowanceToday)}</span>
        </div>
      </div>

      {/* log */}
      <div style={{ ...panel, marginTop: 12 }}>
        <div style={{ ...label, marginBottom: 10 }}>Записать трату</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input type="number" inputMode="decimal" placeholder="0,00" value={input}
            onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addSpend(input)}
            style={{ ...inputStyle, flex: 1, fontSize: 20, fontWeight: 600 }} />
          <button onClick={() => addSpend(input)} style={{ ...primaryBtn, padding: "0 20px" }}>+ Добавить</button>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          {[3, 5, 10, 15].map((v) => (
            <button key={v} className="chip" onClick={() => addSpend(v)} style={chip}>+{v} €</button>
          ))}
        </div>
      </div>

      {/* today */}
      {todayEntries.length > 0 && (
        <div style={{ ...panel, marginTop: 12 }}>
          <div style={{ ...label, marginBottom: 10 }}>Сегодня · {eur(m.spentToday)}</div>
          {todayEntries.map((e) => (
            <div key={e.id} style={rowItem}>
              <span style={{ fontFamily: mono, fontSize: 16 }}>{eur(e.amount)}</span>
              <button onClick={() => removeEntry(e.id)} style={delBtn}>удалить</button>
            </div>
          ))}
        </div>
      )}

      {/* moto fund */}
      <div style={{ ...panel, marginTop: 12, background: "linear-gradient(135deg,#1a2740,#191C22)", borderColor: "#243350" }}>
        <div style={label}>Мотофонд 🏍️</div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>прогноз к зарплате при текущем темпе</div>
        <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 38, color: C.green, marginTop: 8, letterSpacing: -0.5 }}>
          {eur(m.projectedSavings)}
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <MiniStat label="Осталось из 800" value={eur(m.remainingBudget)} color={m.remainingBudget < 0 ? C.red : C.text} />
          <MiniStat label="Прогноз трат" value={eur(m.projectedTotal)} color={C.text} />
        </div>
      </div>

      {/* history */}
      {pastByDay.length > 0 && (
        <div style={{ ...panel, marginTop: 12 }}>
          <div style={{ ...label, marginBottom: 10 }}>История по дням</div>
          {pastByDay.map(([date, amt]) => {
            const over = amt > config.livingBudget / config.totalDays;
            return (
              <div key={date} style={rowItem}>
                <span style={{ color: C.muted, fontSize: 14 }}>{prettyDate(date)}</span>
                <span style={{ fontFamily: mono, fontSize: 15, color: over ? C.amber : C.green }}>{eur(amt)}</span>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ textAlign: "center", color: C.muted, fontSize: 11, marginTop: 16, lineHeight: 1.5 }}>
        Тикеты на еду считаются отдельно и сюда не входят.<br />Подушка 350 € — неприкосновенна.
      </div>

      {showSettings && (
        <div style={overlay} onClick={() => setShowSettings(false)}>
          <div style={modal} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Настройки</div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 16 }}>После двух недель можно поднять бюджет здесь.</div>
            <Field label="Живые деньги, €" value={draft.livingBudget} onChange={(v) => setDraft({ ...draft, livingBudget: v })} />
            <Field label="Всего дней" value={draft.totalDays} onChange={(v) => setDraft({ ...draft, totalDays: v })} />
            <Field label="Старт (ГГГГ-ММ-ДД)" value={draft.startISO} type="text" onChange={(v) => setDraft({ ...draft, startISO: v })} />
            <Field label="База накоплений, €" value={draft.baseSavings} onChange={(v) => setDraft({ ...draft, baseSavings: v })} />
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button onClick={() => setShowSettings(false)} style={{ ...chip, flex: 1, padding: "12px" }}>Отмена</button>
              <button disabled={saving} onClick={saveSettings} style={{ ...primaryBtn, flex: 1, padding: "12px" }}>
                {saving ? "…" : "Сохранить"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value, color }) {
  return (
    <div style={{ flex: 1, background: C.surface2, borderRadius: 12, padding: "10px 12px", border: `1px solid ${C.border}` }}>
      <div style={{ fontSize: 11, color: C.muted }}>{label}</div>
      <div style={{ fontFamily: mono, fontSize: 17, color, marginTop: 3, fontWeight: 600 }}>{value}</div>
    </div>
  );
}
function Field({ label, value, onChange, type = "number" }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 5 }}>{label}</div>
      <input type={type} inputMode={type === "number" ? "decimal" : "text"} value={value}
        onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, fontSize: 16 }} />
    </div>
  );
}

// ---------- styles ----------
const wrap = { fontFamily: sans, background: C.bg, color: C.text, minHeight: "100vh",
  maxWidth: 460, margin: "0 auto", padding: "calc(20px + env(safe-area-inset-top)) 16px calc(32px + env(safe-area-inset-bottom))",
  display: "flex", flexDirection: "column" };
const panel = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 18, padding: 18 };
const label = { fontSize: 12, letterSpacing: 1.5, color: C.muted, textTransform: "uppercase" };
const iconBtn = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, color: C.text, width: 42, height: 42, fontSize: 17 };
const chip = { background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontWeight: 600, fontSize: 14, padding: "9px 14px", transition: "transform .08s" };
const rowItem = { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 0", borderTop: `1px solid ${C.border}` };
const delBtn = { background: "transparent", border: "none", color: C.red, fontSize: 12 };
const inputStyle = { width: "100%", background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 12, color: C.text, fontFamily: mono, padding: "12px 14px", fontSize: 16 };
const primaryBtn = { background: C.blue, border: "none", borderRadius: 12, color: "#fff", fontWeight: 700, fontSize: 15 };
const overlay = { position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 50 };
const modal = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 18, padding: 20, width: "100%", maxWidth: 380 };
