import React, { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "./supabase.js";

// ---------- palette (instrument cluster) ----------
const C = {
  bg: "#0B0D11", surface: "#15181E", surface2: "#1D212A", border: "#262B34",
  text: "#EDEFF3", muted: "#868D98", faint: "#5A616B", blue: "#3B82F6",
  green: "#2FBF87", amber: "#F5A623", red: "#F0655F",
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
const signEur = (v) => (v > 0 ? "+" : v < 0 ? "-" : "") + Math.abs(v).toFixed(2).replace(".", ",") + " €";

// =====================================================================
export default function App() {
  const [session, setSession] = useState(undefined);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);
  if (session === undefined) return <Splash />;
  if (session === null) return <Auth />;
  return <Tracker session={session} />;
}

function Splash() {
  return (
    <div style={{ ...wrap, alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
      <div style={{ color: C.muted, fontFamily: mono }}>Загрузка…</div>
    </div>
  );
}

function Auth() {
  const [mode, setMode] = useState("login");
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
    } catch (e) { setMsg(e.message || "Ошибка"); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ ...wrap, minHeight: "100vh", justifyContent: "center" }}>
      <div style={{ marginBottom: 22, textAlign: "center" }}>
        <div style={{ fontSize: 22, fontWeight: 700 }}>Бюджет</div>
        <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>дневной расчёт до зарплаты</div>
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
  const [tab, setTab] = useState("budget"); // budget | chart

  const mapConfig = (row) => ({
    livingBudget: Number(row.living_budget), totalDays: row.total_days,
    startISO: row.start_date, baseSavings: Number(row.base_savings),
  });

  const load = useCallback(async () => {
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
    const { data: rows } = await supabase.from("entries").select("*").eq("user_id", uid).order("created_at", { ascending: false });
    setEntries((rows ?? []).map((r) => ({ id: r.id, date: r.spent_on, amount: Number(r.amount) })));
    setLoaded(true);
  }, [uid]);
  useEffect(() => { load(); }, [load]);

  // ----- math (конвертная модель: несpotраченный лимит переносится вперёд) -----
  const m = useMemo(() => {
    const today = todayStr();
    const idxRaw = daysBetween(config.startISO, today);
    const todayIndex = Math.max(0, Math.min(idxRaw, config.totalDays - 1));
    const daysRemaining = Math.max(1, config.totalDays - todayIndex);
    const completedDays = todayIndex;
    const baselineDaily = config.livingBudget / config.totalDays;

    const spentToday = entries.filter((e) => e.date === today).reduce((s, e) => s + e.amount, 0);
    const spentBeforeToday = entries.filter((e) => e.date < today).reduce((s, e) => s + e.amount, 0);
    const totalSpent = spentBeforeToday + spentToday;

    const remainingBudget = config.livingBudget - totalSpent;

    // перенос: сэкономлено (>0) или перерасход (<0) за все прошлые дни
    const carryIn = baselineDaily * completedDays - spentBeforeToday;
    // сегодня доступно = дневная база + перенос с прошлых дней
    const todayAllowance = baselineDaily + carryIn;
    const leftToday = todayAllowance - spentToday;
    // что перейдёт на завтра, если закрыть день с текущими тратами
    const carryTomorrow = carryIn + (baselineDaily - spentToday);

    let projectedTotal;
    if (completedDays >= 1) {
      const avg = spentBeforeToday / completedDays;
      projectedTotal = spentBeforeToday + avg * daysRemaining;
    } else projectedTotal = config.livingBudget;
    const projectedSavings = config.baseSavings + (config.livingBudget - projectedTotal);

    const ratio = todayAllowance > 0 ? spentToday / todayAllowance : (spentToday > 0 ? 1.2 : 0);
    const status = ratio > 1 ? "red" : ratio > 0.75 ? "amber" : "green";
    const endISO = addDays(config.startISO, config.totalDays - 1);

    return { today, todayIndex, daysRemaining, spentToday, totalSpent, remainingBudget,
      baselineDaily, carryIn, todayAllowance, leftToday, carryTomorrow,
      projectedSavings, projectedTotal, ratio, status, endISO };
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

  if (!loaded) return <Splash />;

  return (
    <div style={wrap}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
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

      {/* tabs */}
      <div style={{ display: "flex", gap: 5, marginBottom: 14, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 13, padding: 4 }}>
        {[["budget", "Бюджет"], ["chart", "График"], ["history", "История"]].map(([k, lbl]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            flex: 1, padding: "10px", borderRadius: 10, fontWeight: 500, fontSize: 14,
            background: tab === k ? C.blue : "transparent", color: tab === k ? "#fff" : C.muted,
            transition: "background .15s",
          }}>{lbl}</button>
        ))}
      </div>

      {tab === "budget" ? (
        <>
          {/* HERO — кольцо дня */}
          <div style={{ ...panel, padding: "22px 20px 20px", display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ ...label, alignSelf: "flex-start" }}>Осталось на сегодня</div>

            <div style={{ position: "relative", width: 184, height: 184, marginTop: 12 }}>
              <svg width="184" height="184" viewBox="0 0 184 184">
                <circle cx="92" cy="92" r="82" fill="none" stroke={C.surface2} strokeWidth="13" />
                <circle cx="92" cy="92" r="82" fill="none" stroke={statusColor} strokeWidth="13"
                  strokeLinecap="round" transform="rotate(-90 92 92)"
                  strokeDasharray={2 * Math.PI * 82}
                  strokeDashoffset={2 * Math.PI * 82 * (1 - Math.min(Math.max(m.ratio, 0), 1))}
                  style={{ transition: "stroke-dashoffset .6s ease" }} />
              </svg>
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 34, letterSpacing: -0.5,
                  color: m.leftToday < 0 ? C.red : C.text, whiteSpace: "nowrap" }}>
                  {eur(m.leftToday)}
                </div>
                <div style={{ fontSize: 11, color: statusColor, marginTop: 5 }}>
                  {m.status === "red" ? "перебор" : m.status === "amber" ? "почти лимит" : "в норме"}
                </div>
                <div style={{ fontSize: 11, color: C.faint, marginTop: 2 }}>из {eur(m.todayAllowance)}</div>
              </div>
            </div>

            {m.carryIn > 0.005 && (
              <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 18, width: "100%",
                background: "#12241C", border: "1px solid #1E4436", borderRadius: 12, padding: "10px 13px" }}>
                <span style={{ fontFamily: mono, fontWeight: 700, fontSize: 20, color: C.green, whiteSpace: "nowrap" }}>+{eur(m.carryIn)}</span>
                <span style={{ fontSize: 12.5, color: "#8FBFA8", lineHeight: 1.3 }}>сэкономлено — добавлено к лимиту</span>
              </div>
            )}
            {m.carryIn < -0.005 && (
              <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 18, width: "100%",
                background: "#241514", border: "1px solid #442020", borderRadius: 12, padding: "10px 13px" }}>
                <span style={{ fontFamily: mono, fontWeight: 700, fontSize: 20, color: C.red, whiteSpace: "nowrap" }}>{eur(m.carryIn)}</span>
                <span style={{ fontSize: 12.5, color: "#C39A9A", lineHeight: 1.3 }}>перерасход — вычтено из лимита</span>
              </div>
            )}

            <div style={{ display: "flex", width: "100%", marginTop: 16, gap: 8 }}>
              {[["база", eur(m.baselineDaily)], ["потрачено", eur(m.spentToday)],
                ...(m.daysRemaining > 1 ? [["завтра", signEur(m.carryTomorrow)]] : [])].map(([k, v], i) => (
                <div key={i} style={{ flex: 1, textAlign: "center", background: C.surface2, borderRadius: 10, padding: "8px 4px" }}>
                  <div style={{ fontSize: 10, color: C.faint, textTransform: "uppercase", letterSpacing: 0.5 }}>{k}</div>
                  <div style={{ fontFamily: mono, fontSize: 13, color: C.muted, marginTop: 3, whiteSpace: "nowrap" }}>{v}</div>
                </div>
              ))}
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
            <div style={{ fontSize: 12, color: C.muted, marginTop: 10 }}>
              Вносить можно сколько угодно раз за день — суммируется.
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

          {/* накопления */}
          <div style={{ ...panel, marginTop: 12 }}>
            <div style={label}>Накопления к зарплате</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>прогноз при текущем темпе трат</div>
            <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 34, color: C.green, marginTop: 8, letterSpacing: -0.5 }}>
              {eur(m.projectedSavings)}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              <MiniStat label={`Осталось из ${eur(config.livingBudget)}`} value={eur(m.remainingBudget)} color={m.remainingBudget < 0 ? C.red : C.text} />
              <MiniStat label="Прогноз трат" value={eur(m.projectedTotal)} color={C.text} />
            </div>
          </div>
        </>
      ) : tab === "chart" ? (
        <ChartView config={config} entries={entries} m={m} />
      ) : (
        <HistoryView config={config} entries={entries} m={m} onRemove={removeEntry} />
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

// ---------- chart page ----------
function ChartView({ config, entries, m }) {
  const data = useMemo(() => {
    const arr = [];
    for (let i = 0; i <= m.todayIndex; i++) {
      const date = addDays(config.startISO, i);
      const spent = entries.filter((e) => e.date === date).reduce((s, e) => s + e.amount, 0);
      arr.push({ i, date, spent });
    }
    return arr;
  }, [config, entries, m.todayIndex]);

  const target = m.baselineDaily;
  const maxVal = Math.max(target * 1.4, ...data.map((d) => d.spent), 1);

  const W = 320, H = 180, padL = 8, padR = 8, padT = 10, padB = 22;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const n = data.length;
  const gap = 3;
  const bw = n > 0 ? Math.max(3, innerW / n - gap) : 0;
  const yFor = (v) => padT + innerH - (v / maxVal) * innerH;
  const targetY = yFor(target);

  const totalSpent = data.reduce((s, d) => s + d.spent, 0);
  const daysCounted = data.length;
  const avg = daysCounted ? totalSpent / daysCounted : 0;

  return (
    <>
      <div style={{ ...panel }}>
        <div style={label}>Расходы по дням</div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 3, marginBottom: 12 }}>
          пунктир — ровный лимит {eur(target)}/день
        </div>
        {n === 0 ? (
          <div style={{ color: C.muted, fontSize: 14, padding: "24px 0", textAlign: "center" }}>
            Пока нет данных. Внеси первую трату.
          </div>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
            {/* target line */}
            <line x1={padL} y1={targetY} x2={W - padR} y2={targetY}
              stroke={C.blue} strokeWidth="1" strokeDasharray="4 4" opacity="0.7" />
            {data.map((d, k) => {
              const x = padL + k * (bw + gap);
              const y = yFor(d.spent);
              const h = padT + innerH - y;
              const over = d.spent > target;
              const col = d.spent === 0 ? C.green : over ? C.amber : C.green;
              return (
                <g key={d.date}>
                  <rect x={x} y={d.spent === 0 ? padT + innerH - 2 : y} width={bw}
                    height={d.spent === 0 ? 2 : Math.max(h, 1)} rx="2" fill={col}
                    opacity={d.date === m.today ? 1 : 0.85} />
                  {(k === 0 || k === n - 1 || k % Math.ceil(n / 6) === 0) && (
                    <text x={x + bw / 2} y={H - 8} fill={C.muted} fontSize="8"
                      textAnchor="middle" fontFamily={mono}>{dateFromISO(d.date).getDate()}</text>
                  )}
                </g>
              );
            })}
          </svg>
        )}
        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <MiniStat label="Всего потрачено" value={eur(totalSpent)} color={C.text} />
          <MiniStat label="Среднее в день" value={eur(avg)} color={avg > target ? C.amber : C.green} />
        </div>
      </div>

      {/* cumulative vs ideal */}
      <div style={{ ...panel, marginTop: 12 }}>
        <div style={label}>Накопительно против плана</div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 3, marginBottom: 12 }}>
          синяя — план, зелёная/красная — факт
        </div>
        <CumulativeChart data={data} target={target} today={m.today} />
      </div>
    </>
  );
}

function CumulativeChart({ data, target, today }) {
  const W = 320, H = 150, padL = 8, padR = 8, padT = 10, padB = 20;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const n = data.length;
  if (n === 0) return <div style={{ color: C.muted, fontSize: 14, padding: "20px 0", textAlign: "center" }}>Нет данных</div>;

  let cum = 0;
  const actual = data.map((d, k) => { cum += d.spent; return { k, v: cum }; });
  const idealMax = target * n;
  const actualMax = cum;
  const maxV = Math.max(idealMax, actualMax, 1);
  const xFor = (k) => padL + (n === 1 ? innerW / 2 : (k / (n - 1)) * innerW);
  const yFor = (v) => padT + innerH - (v / maxV) * innerH;

  const idealPath = `M ${xFor(0)} ${yFor(target)} L ${xFor(n - 1)} ${yFor(idealMax)}`;
  const actualPts = actual.map((p) => `${xFor(p.k)},${yFor(p.v)}`).join(" ");
  const actualColor = actualMax <= target * n ? C.green : C.red;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
      <line x1={padL} y1={yFor(0)} x2={W - padR} y2={yFor(0)} stroke={C.border} strokeWidth="1" />
      <path d={idealPath} stroke={C.blue} strokeWidth="1.5" fill="none" strokeDasharray="4 4" opacity="0.7" />
      <polyline points={actualPts} stroke={actualColor} strokeWidth="2" fill="none" strokeLinejoin="round" strokeLinecap="round" />
      {actual.map((p) => (
        <circle key={p.k} cx={xFor(p.k)} cy={yFor(p.v)} r={p.k === n - 1 ? 3 : 1.5} fill={actualColor} />
      ))}
    </svg>
  );
}

// ---------- history page (grouped by week, expandable days, delete any entry) ----------
function HistoryView({ config, entries, m, onRemove }) {
  const [open, setOpen] = useState(m.today);
  const weeklyTarget = m.baselineDaily * 7;

  const weeks = useMemo(() => {
    const byDate = {};
    entries.forEach((e) => { (byDate[e.date] ||= []).push(e); });
    const days = Object.entries(byDate).map(([date, list]) => ({
      date,
      weekIdx: Math.floor(daysBetween(config.startISO, date) / 7),
      total: list.reduce((s, e) => s + e.amount, 0),
      list: [...list].sort((a, b) => (a.id < b.id ? 1 : -1)),
    }));
    const wk = {};
    days.forEach((d) => { (wk[d.weekIdx] ||= []).push(d); });
    return Object.entries(wk)
      .map(([idx, dayList]) => ({
        idx: Number(idx),
        days: dayList.sort((a, b) => (a.date < b.date ? 1 : -1)),
        total: dayList.reduce((s, d) => s + d.total, 0),
      }))
      .sort((a, b) => b.idx - a.idx);
  }, [entries, config.startISO]);

  if (weeks.length === 0) {
    return (
      <div style={panel}>
        <div style={label}>История</div>
        <div style={{ color: C.muted, fontSize: 14, padding: "24px 0", textAlign: "center" }}>
          Пока пусто. Записи появятся здесь по неделям.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {weeks.map((w) => {
        const wStart = addDays(config.startISO, w.idx * 7);
        const wEnd = addDays(config.startISO, w.idx * 7 + 6);
        const over = w.total > weeklyTarget;
        return (
          <div key={w.idx} style={panel}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
              <div style={label}>Неделя {w.idx + 1}</div>
              <div style={{ fontFamily: mono, fontSize: 18, fontWeight: 700, color: over ? C.amber : C.green }}>
                {eur(w.total)}
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: C.muted, marginBottom: 6 }}>
              <span>{prettyDate(wStart)} – {prettyDate(wEnd)}</span>
              <span>лимит {eur(weeklyTarget)}</span>
            </div>

            {w.days.map((d) => {
              const isOpen = open === d.date;
              const dOver = d.total > m.baselineDaily;
              return (
                <div key={d.date} style={{ borderTop: `1px solid ${C.border}` }}>
                  <button onClick={() => setOpen(isOpen ? null : d.date)} style={{
                    width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "11px 0", background: "none", color: C.text,
                  }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ color: C.muted, fontSize: 10, transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▶</span>
                      <span style={{ fontSize: 14 }}>
                        {prettyDate(d.date)}{d.date === m.today ? " · сегодня" : ""}
                      </span>
                    </span>
                    <span style={{ fontFamily: mono, fontSize: 15, color: d.total === 0 ? C.muted : dOver ? C.amber : C.green }}>
                      {eur(d.total)}
                    </span>
                  </button>
                  {isOpen && (
                    <div style={{ paddingBottom: 8 }}>
                      {d.list.map((e) => (
                        <div key={e.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0 8px 22px" }}>
                          <span style={{ fontFamily: mono, fontSize: 15 }}>{eur(e.amount)}</span>
                          <button onClick={() => onRemove(e.id)} style={delBtn}>удалить</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
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