import React, { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "./supabase.js";

// ---------- palette ----------
const C = {
  bg: "#0B0D11", surface: "#15181E", surface2: "#1D212A", border: "#262B34",
  text: "#EDEFF3", muted: "#868D98", faint: "#5A616B", blue: "#3B82F6",
  green: "#2FBF87", amber: "#F5A623", red: "#F0655F",
};
const mono = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
const sans = "'Inter', system-ui, -apple-system, sans-serif";

const DEFAULT_PERIOD = { livingBudget: 800, totalDays: 45, startISO: "2026-07-15", label: "Текущий период" };

// ---------- helpers ----------
const pad = (n) => String(n).padStart(2, "0");
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const dateFromISO = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const daysBetween = (a, b) => Math.round((dateFromISO(b) - dateFromISO(a)) / 86400000);
const addDays = (iso, n) => { const d = dateFromISO(iso); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const RU_MONTHS = ["янв","фев","мар","апр","мая","июн","июл","авг","сен","окт","ноя","дек"];
const prettyDate = (iso) => { const d = dateFromISO(iso); return `${d.getDate()} ${RU_MONTHS[d.getMonth()]}`; };
const eur = (v) => (v < 0 ? "-" : "") + Math.abs(v).toFixed(2).replace(".", ",") + " €";
const signEur = (v) => (v > 0 ? "+" : v < 0 ? "-" : "") + Math.abs(v).toFixed(2).replace(".", ",") + " €";
const parseNum = (v) => { const n = parseFloat(String(v).replace(",", ".")); return isFinite(n) ? n : NaN; };

const ACCENTS = [
  { id: "blue", color: "#3B82F6" }, { id: "teal", color: "#28C0B8" },
  { id: "green", color: "#2FBF87" }, { id: "purple", color: "#7C6CF0" },
  { id: "pink", color: "#E85A9B" }, { id: "orange", color: "#F5893B" },
  { id: "red", color: "#F0655F" },
];

// =====================================================================
export default function App() {
  const [session, setSession] = useState(undefined);
  const [accent, setAccentState] = useState(() => {
    try { return localStorage.getItem("accent") || ACCENTS[0].color; } catch { return ACCENTS[0].color; }
  });
  const setAccent = (c) => { setAccentState(c); try { localStorage.setItem("accent", c); } catch {} };
  useEffect(() => { document.documentElement.style.setProperty("--accent", accent); }, [accent]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);
  if (session === undefined) return <Splash />;
  if (session === null) return <Auth />;
  return <Tracker session={session} accent={accent} setAccent={setAccent} />;
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
        <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>месяц · доходы · копилка</div>
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
          style={{ color: "var(--accent, #3B82F6)", fontSize: 13, marginTop: 14, background: "none", width: "100%" }}>
          {mode === "login" ? "Нет аккаунта? Создать" : "Уже есть аккаунт? Войти"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
const goalBalance = (goal, contribs) =>
  Number(goal.seed || 0) + contribs.filter((c) => c.goalId === goal.id).reduce((s, c) => s + c.amount, 0);
const sumObl = (obl) => (obl || []).reduce((s, o) => s + (parseNum(o.amount) || 0), 0);

function Tracker({ session, accent, setAccent }) {
  const uid = session.user.id;
  const [loaded, setLoaded] = useState(false);
  const [period, setPeriod] = useState(null);
  const [entries, setEntries] = useState([]);
  const [incomes, setIncomes] = useState([]);
  const [goals, setGoals] = useState([]);
  const [contribs, setContribs] = useState([]);
  const [input, setInput] = useState("");
  const [nav, setNav] = useState("home");          // home | feed | savings | income
  const [feedSub, setFeedSub] = useState("ops");   // ops | cal | chart
  const [showAdd, setShowAdd] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // modals
  const [routeFor, setRouteFor] = useState(null);  // income needing goal choice
  const [showClose, setShowClose] = useState(false);
  const [confirm, setConfirm] = useState(null);    // { title, message, confirmText, danger, onYes }

  // ---- load ----
  const load = useCallback(async () => {
    // active period
    let { data: per } = await supabase.from("periods").select("*")
      .eq("user_id", uid).eq("status", "active").order("created_at", { ascending: false }).maybeSingle();
    if (!per) {
      const ins = await supabase.from("periods").insert({
        user_id: uid, label: DEFAULT_PERIOD.label, living_budget: DEFAULT_PERIOD.livingBudget,
        total_days: DEFAULT_PERIOD.totalDays, start_date: DEFAULT_PERIOD.startISO, status: "active",
      }).select().single();
      per = ins.data;
    }
    setPeriod({ id: per.id, label: per.label, livingBudget: Number(per.living_budget),
      totalDays: per.total_days, startISO: per.start_date,
      income: Number(per.income || 0), obligations: per.obligations || [],
      extras: per.extras || [],
      reservedSavings: Number(per.reserved_savings || 0) });

    const { data: ent } = await supabase.from("entries").select("*")
      .eq("user_id", uid).eq("period_id", per.id).order("created_at", { ascending: false });
    setEntries((ent ?? []).map((r) => ({ id: r.id, date: r.spent_on, amount: Number(r.amount) })));

    const { data: inc } = await supabase.from("incomes").select("*")
      .eq("user_id", uid).order("received_on", { ascending: false }).order("created_at", { ascending: false });
    setIncomes((inc ?? []).map((r) => ({ id: r.id, date: r.received_on, amount: Number(r.amount),
      source: r.source || "", status: r.status, periodId: r.period_id, goalId: r.goal_id })));

    const { data: gl } = await supabase.from("goals").select("*")
      .eq("user_id", uid).neq("status", "archived").order("created_at", { ascending: true });
    setGoals((gl ?? []).map((r) => ({ id: r.id, name: r.name, target: r.target_amount != null ? Number(r.target_amount) : null,
      deadline: r.deadline, seed: Number(r.seed || 0), status: r.status })));

    const { data: con } = await supabase.from("contributions").select("*")
      .eq("user_id", uid).order("created_at", { ascending: false });
    setContribs((con ?? []).map((r) => ({ id: r.id, goalId: r.goal_id, amount: Number(r.amount),
      source: r.source, sourceId: r.source_id, note: r.note || "", createdAt: r.created_at })));

    setLoaded(true);
  }, [uid]);
  useEffect(() => { load(); }, [load]);

  // сумма всех копилок — реактивная
  const savingsTotal = useMemo(
    () => goals.reduce((s, g) => s + goalBalance(g, contribs), 0),
    [goals, contribs]
  );
  // часть копилок, пополненная сторонними деньгами (через «Доходы» → «В копилку»).
  // такие деньги пришли извне, поэтому НЕ уменьшают «на жизнь» текущего периода.
  const externalSavings = useMemo(
    () => contribs.filter((c) => c.source === "income").reduce((s, c) => s + c.amount, 0),
    [contribs]
  );
  // разовые расходы, оплаченные «из копилки» (отрицательные взносы source='oneoff').
  // они уменьшают накопления и НЕ должны возвращаться в дневной лимит.
  const oneoffSavings = useMemo(
    () => contribs.filter((c) => c.source === "oneoff").reduce((s, c) => s + c.amount, 0),
    [contribs]
  );

  // ---- math (envelope + доходы, отправленные в бюджет) ----
  const m = useMemo(() => {
    if (!period) return null;
    const today = todayStr();
    const idxRaw = daysBetween(period.startISO, today);
    const todayIndex = Math.max(0, Math.min(idxRaw, period.totalDays - 1));
    const daysRemaining = Math.max(1, period.totalDays - todayIndex);
    const completedDays = todayIndex;

    // база считается ЧИСТОЙ (без разовых): прошлые дни не переписываются.
    // разовые «из жизни» и доходы «в бюджет» размазываются только на оставшиеся дни.
    const ownSavings = savingsTotal - externalSavings;
    const oneoffSum = sumObl(period.extras);
    const reservedSavings = period.income > 0 ? ownSavings : period.reservedSavings;
    const coreLiving = period.income > 0
      ? Math.max(0, period.income - sumObl(period.obligations) - ownSavings + oneoffSavings)
      : period.livingBudget;

    const budgetIncome = incomes.filter((i) => i.status === "budget" && i.periodId === period.id)
      .reduce((s, i) => s + i.amount, 0);
    const livingPool = coreLiving + budgetIncome - oneoffSum;   // итоговый котёл на жизнь
    const baselineDaily = coreLiving / period.totalDays;         // чистая база
    const remainingAdjust = (budgetIncome - oneoffSum) / daysRemaining;
    const remainingAdjustTomorrow = (budgetIncome - oneoffSum) / Math.max(1, daysRemaining - 1);
    const dailyNow = baselineDaily + remainingAdjust;            // фактический дневной темп сейчас
    const effectiveLiving = livingPool;

    const spentToday = entries.filter((e) => e.date === today).reduce((s, e) => s + e.amount, 0);
    const spentBeforeToday = entries.filter((e) => e.date < today).reduce((s, e) => s + e.amount, 0);
    const totalSpent = spentBeforeToday + spentToday;
    const remainingBudget = livingPool - totalSpent;

    const carryIn = baselineDaily * completedDays - spentBeforeToday;
    const todayAllowance = baselineDaily + carryIn + remainingAdjust;
    const leftToday = todayAllowance - spentToday;
    const carryTomorrow = carryIn + (baselineDaily - spentToday);
    const tomorrowAllowance = carryTomorrow + baselineDaily + remainingAdjustTomorrow; // стартовый лимит завтра

    let projectedTotal;
    if (completedDays >= 1) { const avg = spentBeforeToday / completedDays; projectedTotal = spentBeforeToday + avg * daysRemaining; }
    else projectedTotal = effectiveLiving;
    const projectedLeftover = effectiveLiving - projectedTotal;

    const ratio = todayAllowance > 0 ? spentToday / todayAllowance : (spentToday > 0 ? 1.2 : 0);
    const status = leftToday < -0.005 || todayAllowance < -0.005 ? "red" : ratio > 1 ? "red" : ratio > 0.75 ? "amber" : "green";
    const endISO = addDays(period.startISO, period.totalDays - 1);

    return { today, todayIndex, daysRemaining, spentToday, totalSpent, remainingBudget, budgetIncome,
      effectiveLiving, reservedSavings, oneoffSpent: -oneoffSavings, baselineDaily, dailyNow, carryIn, todayAllowance, leftToday, carryTomorrow, tomorrowAllowance,
      projectedTotal, projectedLeftover, ratio, status, endISO };
  }, [period, entries, incomes, savingsTotal, externalSavings, oneoffSavings]);


  // ---- spend handlers ----
  const addSpend = async (val) => {
    const n = parseNum(val); if (!isFinite(n) || n <= 0 || !period) return;
    setInput("");
    const optimistic = { id: "tmp-" + Date.now(), date: todayStr(), amount: n };
    setEntries((prev) => [optimistic, ...prev]);
    const { data, error } = await supabase.from("entries")
      .insert({ user_id: uid, period_id: period.id, spent_on: optimistic.date, amount: n }).select().single();
    if (error) { setEntries((prev) => prev.filter((e) => e.id !== optimistic.id)); return; }
    setEntries((prev) => prev.map((e) => e.id === optimistic.id ? { id: data.id, date: data.spent_on, amount: Number(data.amount) } : e));
  };
  const removeEntry = async (id) => { setEntries((prev) => prev.filter((e) => e.id !== id)); await supabase.from("entries").delete().eq("id", id); };

  // ---- one-off large expenses (не дневные, не плановые) ----
  const addExtra = async (name, amount, date) => {
    const n = parseNum(amount); if (!isFinite(n) || n <= 0 || !period) return;
    const item = { name: name || "Расход", amount: n, date: date || todayStr() };
    const next = [...(period.extras || []), item];
    setPeriod((p) => ({ ...p, extras: next }));
    await supabase.from("periods").update({ extras: next }).eq("id", period.id);
  };
  const removeExtra = async (idx) => {
    const next = (period.extras || []).filter((_, i) => i !== idx);
    setPeriod((p) => ({ ...p, extras: next }));
    await supabase.from("periods").update({ extras: next }).eq("id", period.id);
  };

  // ---- income handlers ----
  const addIncome = async (amount, date, source) => {
    const n = parseNum(amount); if (!isFinite(n) || n <= 0) return;
    const { data } = await supabase.from("incomes").insert({
      user_id: uid, amount: n, received_on: date || todayStr(), source: source || null, status: "pending",
    }).select().single();
    if (data) setIncomes((prev) => [{ id: data.id, date: data.received_on, amount: Number(data.amount),
      source: data.source || "", status: data.status, periodId: null, goalId: null }, ...prev]);
  };
  const deleteIncome = async (income) => {
    setIncomes((prev) => prev.filter((i) => i.id !== income.id));
    await supabase.from("contributions").delete().eq("source_id", income.id);
    setContribs((prev) => prev.filter((c) => c.sourceId !== income.id));
    await supabase.from("incomes").delete().eq("id", income.id);
  };
  // route income to: 'budget' | 'savings' | 'pending'
  const routeIncome = async (income, target, goalId = null) => {
    // clear any previous savings contribution linked to this income
    await supabase.from("contributions").delete().eq("source_id", income.id);
    setContribs((prev) => prev.filter((c) => c.sourceId !== income.id));

    if (target === "budget") {
      await supabase.from("incomes").update({ status: "budget", period_id: period.id, goal_id: null }).eq("id", income.id);
      setIncomes((prev) => prev.map((i) => i.id === income.id ? { ...i, status: "budget", periodId: period.id, goalId: null } : i));
    } else if (target === "savings") {
      await supabase.from("incomes").update({ status: "savings", period_id: null, goal_id: goalId }).eq("id", income.id);
      const { data } = await supabase.from("contributions").insert({
        user_id: uid, goal_id: goalId, amount: income.amount, source: "income", source_id: income.id,
      }).select().single();
      setIncomes((prev) => prev.map((i) => i.id === income.id ? { ...i, status: "savings", periodId: null, goalId } : i));
      if (data) setContribs((prev) => [{ id: data.id, goalId, amount: Number(data.amount), source: "income",
        sourceId: income.id, note: "", createdAt: data.created_at }, ...prev]);
    } else {
      await supabase.from("incomes").update({ status: "pending", period_id: null, goal_id: null }).eq("id", income.id);
      setIncomes((prev) => prev.map((i) => i.id === income.id ? { ...i, status: "pending", periodId: null, goalId: null } : i));
    }
  };
  // when user taps "в копилку": choose goal if several
  const sendToSavings = (income) => {
    if (goals.length === 0) { setNav("savings"); return; }
    if (goals.length === 1) routeIncome(income, "savings", goals[0].id);
    else setRouteFor(income);
  };

  // ---- goal handlers ----
  const addGoal = async (name, target, deadline, seed) => {
    const { data } = await supabase.from("goals").insert({
      user_id: uid, name: name || "Копилка",
      target_amount: isFinite(parseNum(target)) ? parseNum(target) : null,
      deadline: deadline || null, seed: isFinite(parseNum(seed)) ? parseNum(seed) : 0, status: "active",
    }).select().single();
    if (data) setGoals((prev) => [...prev, { id: data.id, name: data.name,
      target: data.target_amount != null ? Number(data.target_amount) : null,
      deadline: data.deadline, seed: Number(data.seed || 0), status: data.status }]);
  };
  const editGoal = async (goal, patch) => {
    await supabase.from("goals").update({
      name: patch.name, target_amount: patch.target, deadline: patch.deadline || null,
    }).eq("id", goal.id);
    setGoals((prev) => prev.map((g) => g.id === goal.id ? { ...g, ...patch } : g));
  };
  const archiveGoal = async (goal) => {
    setGoals((prev) => prev.filter((g) => g.id !== goal.id));
    await supabase.from("goals").update({ status: "archived" }).eq("id", goal.id);
  };
  const contribute = async (goalId, amount, note, source = "manual") => {
    const n = parseNum(amount); if (!isFinite(n) || n === 0) return;
    const { data } = await supabase.from("contributions").insert({
      user_id: uid, goal_id: goalId, amount: n, source, note: note || null,
    }).select().single();
    if (data) setContribs((prev) => [{ id: data.id, goalId, amount: Number(data.amount), source,
      sourceId: null, note: note || "", createdAt: data.created_at }, ...prev]);
  };
  const removeContribution = async (id) => {
    setContribs((prev) => prev.filter((c) => c.id !== id));
    await supabase.from("contributions").delete().eq("id", id);
  };
  // разовый расход «из копилки» = отрицательный взнос
  const chargeToGoal = (goalId, amount, name) =>
    contribute(goalId, -Math.abs(parseNum(amount) || 0), name || "Разовый расход", "oneoff");

  // ---- close month / new period (с раскладом дохода) ----
  const closeMonth = async ({ leftoverMove, leftoverGoal, np }) => {
    // np = { label, income, obligations, days, startSavings, startGoal }
    if (leftoverMove > 0 && leftoverGoal) {
      await supabase.from("contributions").insert({
        user_id: uid, goal_id: leftoverGoal, amount: leftoverMove, source: "month_close", note: "Остаток периода",
      });
    }
    const inc = parseNum(np.income) || 0;
    const obl = (np.obligations || []).filter((o) => (parseNum(o.amount) || 0) > 0)
      .map((o) => ({ name: o.name || "Расход", amount: parseNum(o.amount) || 0 }));
    const save = parseNum(np.startSavings) || 0;
    const living = Math.max(0, inc - sumObl(obl) - save);

    await supabase.from("periods").update({ status: "closed" }).eq("id", period.id);
    await supabase.from("periods").insert({
      user_id: uid, label: np.label || "Новый период", living_budget: living,
      total_days: parseInt(np.days) || 30, start_date: todayStr(), status: "active",
      income: inc, obligations: obl, reserved_savings: save,
    });
    if (save > 0 && np.startGoal) {
      await supabase.from("contributions").insert({
        user_id: uid, goal_id: np.startGoal, amount: save, source: "period_start", note: "Из зарплаты",
      });
    }
    setShowClose(false);
    setLoaded(false);
    await load();
  };

  const reopenPeriod = async (pid) => {
    await supabase.from("periods").update({ status: "closed" }).eq("id", period.id);
    await supabase.from("periods").update({ status: "active" }).eq("id", pid);
    setShowSettings(false);
    setLoaded(false);
    await load();
  };

  const saveSettings = async (draft) => {    // draft: { label, income, obligations, totalDays, startISO }
    const inc = parseNum(draft.income) || 0;
    const obl = (draft.obligations || []).filter((o) => (parseNum(o.amount) || 0) > 0)
      .map((o) => ({ name: o.name || "Расход", amount: parseNum(o.amount) || 0, paid: !!o.paid }));
    // для текущего периода "отложено" = то, что уже лежит в копилках (не трогаем, не дублируем)
    const reserved = inc > 0 ? goals.reduce((s, g) => s + goalBalance(g, contribs), 0) : period.reservedSavings;
    const living = inc > 0 ? Math.max(0, inc - sumObl(obl) - sumObl(period.extras) - reserved) : period.livingBudget;
    const patch = {
      label: draft.label || period.label, totalDays: parseInt(draft.totalDays) || period.totalDays,
      startISO: draft.startISO || period.startISO, income: inc, obligations: obl,
      reservedSavings: reserved, livingBudget: living,
    };
    setPeriod((p) => ({ ...p, ...patch }));
    await supabase.from("periods").update({
      living_budget: living, total_days: patch.totalDays, start_date: patch.startISO,
      label: patch.label, income: inc, obligations: obl, reserved_savings: reserved,
    }).eq("id", period.id);
    setShowSettings(false);
  };

  if (!loaded || !m) return <Splash />;

  const pendingTotal = incomes.filter((i) => i.status === "pending").reduce((s, i) => s + i.amount, 0);

  const navTitle = { feed: "Лента", savings: "Копилка", income: "Доходы" }[nav];

  return (
    <div style={wrap}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div>
          {nav === "home" ? (
            <>
              <div style={{ fontSize: 11, letterSpacing: 2, color: C.muted, textTransform: "uppercase" }}>{period.label}</div>
              <div style={{ fontSize: 13, marginTop: 3 }}>
                до {prettyDate(m.endISO)} · осталось <b style={{ color: "var(--accent, #3B82F6)" }}>{m.daysRemaining} дн.</b>
              </div>
            </>
          ) : (
            <div style={{ fontSize: 19, fontWeight: 700 }}>{navTitle}</div>
          )}
        </div>
        <button onClick={() => setShowSettings(true)} style={iconBtn} aria-label="Настройки"><Icon name="gear" /></button>
      </div>

      {nav === "home" && (
        <BudgetOverview m={m} period={period} input={input} setInput={setInput}
          addSpend={addSpend} entries={entries} removeEntry={removeEntry}
          addExtra={addExtra} removeExtra={removeExtra} hideRecord
          goals={goals} chargeToGoal={chargeToGoal}
          savingsTotal={savingsTotal} onCloseMonth={() => setShowClose(true)} />
      )}
      {nav === "feed" && (
        <FeedScreen feedSub={feedSub} setFeedSub={setFeedSub} period={period}
          entries={entries} incomes={incomes} contribs={contribs} m={m} savingsTotal={savingsTotal}
          onRemove={removeEntry} addExtra={addExtra} removeExtra={removeExtra}
          goals={goals} chargeToGoal={chargeToGoal} onCloseMonth={() => setShowClose(true)} />
      )}
      {nav === "savings" && (
        <SavingsView goals={goals} contribs={contribs}
          addGoal={addGoal} editGoal={editGoal} archiveGoal={archiveGoal}
          contribute={contribute} removeContribution={removeContribution} setConfirm={setConfirm} />
      )}
      {nav === "income" && (
        <IncomeView incomes={incomes} goals={goals} m={m}
          addIncome={addIncome} deleteIncome={deleteIncome}
          routeIncome={routeIncome} sendToSavings={sendToSavings} />
      )}

      {/* bottom nav */}
      <div style={navBar}>
        {[["home", "Дом", "home"], ["feed", "Лента", "list"]].map(([k, lbl, ic]) => (
          <button key={k} onClick={() => { setNav(k); }} style={navItem(nav === k)}>
            <Icon name={ic} size={21} color={nav === k ? "var(--accent, #3B82F6)" : C.faint} />{lbl}
          </button>
        ))}
        <div style={{ width: 58, flexShrink: 0 }} />
        {[["savings", "Копилка", "target"], ["income", "Доходы", "income"]].map(([k, lbl, ic]) => (
          <button key={k} onClick={() => { setNav(k); }} style={navItem(nav === k)}>
            <span style={{ position: "relative" }}>
              <Icon name={ic} size={21} color={nav === k ? "var(--accent, #3B82F6)" : C.faint} />
              {k === "income" && pendingTotal > 0.005 && <span style={{ position: "absolute", top: -2, right: -4, width: 7, height: 7, borderRadius: "50%", background: C.amber }} />}
            </span>{lbl}
          </button>
        ))}
      </div>
      <button style={fabStyle} onClick={() => setShowAdd(true)} aria-label="Записать трату"><Icon name="plus" size={26} color="#fff" /></button>

      {showAdd && <AddSheet onAdd={addSpend} onAddExtra={addExtra} onCharge={chargeToGoal} goals={goals} onClose={() => setShowAdd(false)} />}
      {showSettings && (
        <SettingsModal period={period} accent={accent} setAccent={setAccent} savingsTotal={savingsTotal}
          uid={uid} setConfirm={setConfirm} onReopen={reopenPeriod}
          onLogout={() => setConfirm({ title: "Выйти из аккаунта?", message: "Данные сохранены в облаке — при следующем входе всё будет на месте.", confirmText: "Выйти", onYes: () => supabase.auth.signOut() })}
          onClose={() => setShowSettings(false)} onSave={saveSettings} />
      )}
      {routeFor && (
        <GoalPicker goals={goals} contribs={contribs} onPick={(gid) => { routeIncome(routeFor, "savings", gid); setRouteFor(null); }}
          onClose={() => setRouteFor(null)} />
      )}
      {showClose && (
        <CloseMonthModal m={m} goals={goals} contribs={contribs}
          onClose={() => setShowClose(false)} onConfirm={closeMonth} />
      )}
      {confirm && (
        <ConfirmModal {...confirm} onClose={() => setConfirm(null)} />
      )}
    </div>
  );
}

// ---------- BUDGET · overview ----------
function BudgetOverview({ m, period, input, setInput, addSpend, entries, removeEntry, addExtra, removeExtra, hideRecord, goals, chargeToGoal, savingsTotal, onCloseMonth }) {
  const statusColor = { green: C.green, amber: C.amber, red: C.red }[m.status];
  const todayEntries = entries.filter((e) => e.date === m.today);
  return (
    <>
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
            <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 34, letterSpacing: -0.5, color: m.leftToday < 0 ? C.red : C.text, whiteSpace: "nowrap" }}>{eur(m.leftToday)}</div>
            <div style={{ fontSize: 11, color: statusColor, marginTop: 5 }}>{m.status === "red" ? "перебор" : m.status === "amber" ? "почти лимит" : "в норме"}</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>из {eur(m.todayAllowance)}</div>
          </div>
        </div>

        {m.carryIn > 0.005 && (
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 18, width: "100%", background: "#12241C", border: "1px solid #1E4436", borderRadius: 12, padding: "10px 13px" }}>
            <span style={{ fontFamily: mono, fontWeight: 700, fontSize: 20, color: C.green, whiteSpace: "nowrap" }}>+{eur(m.carryIn)}</span>
            <span style={{ fontSize: 12.5, color: "#8FBFA8", lineHeight: 1.3 }}>сэкономлено — добавлено к лимиту</span>
          </div>
        )}
        {m.carryIn < -0.005 && (
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 18, width: "100%", background: "#241514", border: "1px solid #442020", borderRadius: 12, padding: "10px 13px" }}>
            <span style={{ fontFamily: mono, fontWeight: 700, fontSize: 20, color: C.red, whiteSpace: "nowrap" }}>{eur(m.carryIn)}</span>
            <span style={{ fontSize: 12.5, color: "#C39A9A", lineHeight: 1.3 }}>перерасход — вычтено из лимита</span>
          </div>
        )}

        <div style={{ display: "flex", width: "100%", marginTop: 16, gap: 8 }}>
          {[["база", eur(m.dailyNow)], ["потрачено", eur(m.spentToday)],
            ...(m.daysRemaining > 1 ? [["завтра", signEur(m.tomorrowAllowance)]] : [])].map(([k, v], i) => (
            <div key={i} style={{ flex: 1, textAlign: "center", background: C.surface2, borderRadius: 10, padding: "8px 4px" }}>
              <div style={{ fontSize: 10, color: C.faint, textTransform: "uppercase", letterSpacing: 0.5 }}>{k}</div>
              <div style={{ fontFamily: mono, fontSize: 13, color: C.muted, marginTop: 3, whiteSpace: "nowrap" }}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* record */}
      {!hideRecord && (
      <div style={{ ...panel, marginTop: 12 }}>
        <div style={{ ...label, marginBottom: 10 }}>Записать трату</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input type="number" inputMode="decimal" placeholder="0,00" value={input}
            onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addSpend(input)}
            style={{ ...inputStyle, flex: 1, fontSize: 20, fontWeight: 600, fontFamily: mono }} />
          <button onClick={() => addSpend(input)} style={{ ...primaryBtn, padding: "0 20px" }}>+ Добавить</button>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          {[3, 5, 10, 15].map((v) => (<button key={v} onClick={() => addSpend(v)} style={chip}>+{v} €</button>))}
        </div>
      </div>
      )}

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

      {m.budgetIncome > 0.005 && period.income <= 0.005 && (
        <div style={{ ...panel, marginTop: 12, display: "flex", alignItems: "center", gap: 9, padding: "12px 16px" }}>
          <span style={{ fontFamily: mono, fontWeight: 700, color: C.green }}>+{eur(m.budgetIncome)}</span>
          <span style={{ fontSize: 12.5, color: C.muted }}>поступлений добавлено в бюджет месяца</span>
        </div>
      )}
    </>
  );
}

// ---------- INCOME ----------
function IncomeView({ incomes, goals, m, addIncome, deleteIncome, routeIncome, sendToSavings }) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayStr());
  const [source, setSource] = useState("");
  const [adding, setAdding] = useState(false);

  const goalName = (id) => goals.find((g) => g.id === id)?.name || "копилка";
  const pending = incomes.filter((i) => i.status === "pending");
  const inBudget = incomes.filter((i) => i.status === "budget").reduce((s, i) => s + i.amount, 0);
  const inSavings = incomes.filter((i) => i.status === "savings").reduce((s, i) => s + i.amount, 0);
  const pendingSum = pending.reduce((s, i) => s + i.amount, 0);

  const submit = async () => { await addIncome(amount, date, source); setAmount(""); setSource(""); setDate(todayStr()); setAdding(false); };

  return (
    <>
      <div style={panel}>
        <div style={label}>Поступления сверх бюджета</div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>подарки, бонусы, разовые деньги — не влияют на дневной лимит, пока ты сам не решишь</div>
        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <MiniStat label="Не распределено" value={eur(pendingSum)} color={pendingSum > 0 ? C.amber : C.muted} />
          <MiniStat label="В бюджете" value={eur(inBudget)} color={C.text} />
          <MiniStat label="В копилке" value={eur(inSavings)} color={C.green} />
        </div>
      </div>

      {!adding ? (
        <button onClick={() => setAdding(true)} style={{ ...primaryBtn, marginTop: 12, padding: "13px", width: "100%" }}>+ Поступление</button>
      ) : (
        <div style={{ ...panel, marginTop: 12 }}>
          <div style={{ ...label, marginBottom: 10 }}>Новое поступление</div>
          <input type="number" inputMode="decimal" placeholder="Сумма, €" value={amount}
            onChange={(e) => setAmount(e.target.value)} style={{ ...inputStyle, fontSize: 20, fontWeight: 600 }} />
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...inputStyle, marginTop: 10 }} />
          <input type="text" placeholder="Источник (необязательно): подарок, бонус…" value={source}
            onChange={(e) => setSource(e.target.value)} style={{ ...inputStyle, marginTop: 10 }} />
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button onClick={() => { setAdding(false); setAmount(""); setSource(""); }} style={{ ...chip, flex: 1, padding: "12px" }}>Отмена</button>
            <button onClick={submit} style={{ ...primaryBtn, flex: 1, padding: "12px" }}>Добавить</button>
          </div>
        </div>
      )}

      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {incomes.length === 0 && (
          <div style={panel}><div style={{ color: C.muted, fontSize: 14, padding: "18px 0", textAlign: "center" }}>Поступлений пока нет.</div></div>
        )}
        {incomes.map((i) => {
          const badge = i.status === "budget" ? { t: "в бюджете", c: C.blue }
            : i.status === "savings" ? { t: "в копилке · " + goalName(i.goalId), c: C.green }
            : { t: "не распределено", c: C.amber };
          return (
            <div key={i.id} style={panel}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontFamily: mono, fontWeight: 700, fontSize: 22 }}>+{eur(i.amount)}</span>
                <span style={{ fontSize: 11, color: badge.c }}>{badge.t}</span>
              </div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>
                {prettyDate(i.date)}{i.source ? " · " + i.source : ""}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                {i.status !== "budget" && <button onClick={() => routeIncome(i, "budget")} style={miniBtn}>В бюджет</button>}
                {i.status !== "savings" && <button onClick={() => sendToSavings(i)} style={miniBtn}>В копилку</button>}
                {i.status !== "pending" && <button onClick={() => routeIncome(i, "pending")} style={miniBtn}>Вернуть</button>}
                <button onClick={() => deleteIncome(i)} style={{ ...miniBtn, color: C.red, borderColor: "#3a2626" }}>Удалить</button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ---------- SAVINGS ----------
function SavingsView({ goals, contribs, addGoal, editGoal, archiveGoal, contribute, removeContribution, setConfirm }) {
  const [creating, setCreating] = useState(false);
  const [nm, setNm] = useState(""); const [tg, setTg] = useState(""); const [dl, setDl] = useState(""); const [sd, setSd] = useState("");
  const total = goals.reduce((s, g) => s + goalBalance(g, contribs), 0);

  const submit = async () => { await addGoal(nm, tg, dl, sd); setNm(""); setTg(""); setDl(""); setSd(""); setCreating(false); };

  return (
    <>
      <div style={panel}>
        <div style={label}>Все накопления</div>
        <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 34, color: C.green, marginTop: 8, letterSpacing: -0.5 }}>{eur(total)}</div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>сумма по всем копилкам</div>
      </div>

      {!creating ? (
        <button onClick={() => setCreating(true)} style={{ ...primaryBtn, marginTop: 12, padding: "13px", width: "100%" }}>+ Новая копилка</button>
      ) : (
        <div style={{ ...panel, marginTop: 12 }}>
          <div style={{ ...label, marginBottom: 10 }}>Новая копилка</div>
          <input type="text" placeholder="Название (Мотоцикл, Отпуск…)" value={nm} onChange={(e) => setNm(e.target.value)} style={inputStyle} />
          <input type="number" inputMode="decimal" placeholder="Цель, € (необязательно)" value={tg} onChange={(e) => setTg(e.target.value)} style={{ ...inputStyle, marginTop: 10 }} />
          <input type="date" value={dl} onChange={(e) => setDl(e.target.value)} style={{ ...inputStyle, marginTop: 10 }} />
          <input type="number" inputMode="decimal" placeholder="Уже накоплено, € (стартовая сумма)" value={sd} onChange={(e) => setSd(e.target.value)} style={{ ...inputStyle, marginTop: 10 }} />
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button onClick={() => setCreating(false)} style={{ ...chip, flex: 1, padding: "12px" }}>Отмена</button>
            <button onClick={submit} style={{ ...primaryBtn, flex: 1, padding: "12px" }}>Создать</button>
          </div>
        </div>
      )}

      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
        {goals.map((g) => (
          <GoalCard key={g.id} goal={g} contribs={contribs}
            onContribute={contribute} onRemoveContribution={removeContribution}
            onEdit={editGoal} onArchive={archiveGoal} setConfirm={setConfirm} />
        ))}
      </div>
    </>
  );
}

function GoalCard({ goal, contribs, onContribute, onRemoveContribution, onEdit, onArchive, setConfirm }) {
  const [open, setOpen] = useState(false);
  const [amt, setAmt] = useState("");
  const [mode, setMode] = useState(null); // 'add' | 'sub' | 'edit'
  const [enm, setEnm] = useState(goal.name); const [etg, setEtg] = useState(goal.target ?? ""); const [edl, setEdl] = useState(goal.deadline ?? "");

  const list = contribs.filter((c) => c.goalId === goal.id);
  const bal = goalBalance(goal, contribs);
  const pct = goal.target ? Math.min(100, Math.max(0, (bal / goal.target) * 100)) : null;

  let daysLeft = null, perDay = null;
  if (goal.deadline) {
    daysLeft = daysBetween(todayStr(), goal.deadline);
    if (goal.target && daysLeft > 0) perDay = (goal.target - bal) / daysLeft;
  }

  const doAdd = async () => { await onContribute(goal.id, amt, null, "manual"); setAmt(""); setMode(null); };
  const doSub = async () => { const n = parseNum(amt); if (isFinite(n) && n > 0) await onContribute(goal.id, -n, null, "manual"); setAmt(""); setMode(null); };
  const doEdit = async () => { await onEdit(goal, { name: enm || goal.name, target: isFinite(parseNum(etg)) ? parseNum(etg) : null, deadline: edl || null }); setMode(null); };

  const srcLabel = { income: "поступление", month_close: "остаток периода", period_start: "из зарплаты", oneoff: "разовый расход", manual: "вручную" };

  return (
    <div style={panel}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>{goal.name}</div>
        <button onClick={() => setMode(mode === "edit" ? null : "edit")} style={{ ...miniBtn, padding: "7px 10px", display: "flex", alignItems: "center" }} aria-label="Изменить"><Icon name="edit" size={15} color={C.muted} /></button>
      </div>

      {mode === "edit" ? (
        <div style={{ marginTop: 10 }}>
          <input type="text" value={enm} onChange={(e) => setEnm(e.target.value)} placeholder="Название" style={inputStyle} />
          <input type="number" inputMode="decimal" value={etg} onChange={(e) => setEtg(e.target.value)} placeholder="Цель, € (пусто = без цели)" style={{ ...inputStyle, marginTop: 8 }} />
          <input type="date" value={edl || ""} onChange={(e) => setEdl(e.target.value)} style={{ ...inputStyle, marginTop: 8 }} />
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button onClick={() => setConfirm({ title: `Удалить копилку «${goal.name}»?`, message: "Копилка и её история взносов исчезнут. Отменить будет нельзя.", confirmText: "Удалить", danger: true, onYes: () => onArchive(goal) })} style={{ ...miniBtn, color: C.red, borderColor: "#3a2626" }}>Удалить копилку</button>
            <div style={{ flex: 1 }} />
            <button onClick={() => setMode(null)} style={miniBtn}>Отмена</button>
            <button onClick={doEdit} style={{ ...primaryBtn, padding: "8px 14px", fontSize: 13 }}>Сохранить</button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 30, color: C.green, marginTop: 6, letterSpacing: -0.5 }}>{eur(bal)}</div>
          {goal.target != null && (
            <>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>из {eur(goal.target)} · осталось {eur(Math.max(0, goal.target - bal))}</div>
              <div style={{ height: 8, background: C.surface2, borderRadius: 6, marginTop: 8, overflow: "hidden" }}>
                <div style={{ height: "100%", width: pct + "%", background: pct >= 100 ? C.green : "var(--accent, #3B82F6)", transition: "width .5s" }} />
              </div>
            </>
          )}
          {goal.deadline && (
            <div style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>
              срок {prettyDate(goal.deadline)}{daysLeft != null ? (daysLeft >= 0 ? ` · ${daysLeft} дн.` : " · срок прошёл") : ""}
              {perDay != null && perDay > 0 ? ` · нужно ${eur(perDay)}/день` : ""}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button onClick={() => setMode(mode === "add" ? null : "add")} style={{ ...miniBtn, flex: 1 }}>Пополнить</button>
            <button onClick={() => setMode(mode === "sub" ? null : "sub")} style={{ ...miniBtn, flex: 1 }}>Снять</button>
          </div>
          {(mode === "add" || mode === "sub") && (
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <input type="number" inputMode="decimal" placeholder="Сумма, €" value={amt} onChange={(e) => setAmt(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
              <button onClick={mode === "add" ? doAdd : doSub} style={{ ...primaryBtn, padding: "0 18px" }}>{mode === "add" ? "＋" : "－"}</button>
            </div>
          )}

          {list.length > 0 && (
            <button onClick={() => setOpen(!open)} style={{ background: "none", color: C.muted, fontSize: 12, marginTop: 12 }}>
              {open ? "Скрыть историю" : `История взносов (${list.length})`}
            </button>
          )}
          {open && (
            <div style={{ marginTop: 6 }}>
              {list.map((c) => (
                <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderTop: `1px solid ${C.border}` }}>
                  <div>
                    <div style={{ fontFamily: mono, fontSize: 15, color: c.amount < 0 ? C.red : C.green }}>{signEur(c.amount)}</div>
                    <div style={{ fontSize: 11, color: C.faint }}>{srcLabel[c.source] || c.source}{c.note ? " · " + c.note : ""}</div>
                  </div>
                  <button onClick={() => onRemoveContribution(c.id)} style={delBtn}>удалить</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------- CHART ----------
function ChartView({ period, entries, m }) {
  const data = useMemo(() => {
    const arr = [];
    for (let i = 0; i <= m.todayIndex; i++) {
      const date = addDays(period.startISO, i);
      const spent = entries.filter((e) => e.date === date).reduce((s, e) => s + e.amount, 0);
      arr.push({ i, date, spent });
    }
    return arr;
  }, [period, entries, m.todayIndex]);

  const target = m.baselineDaily;
  const maxVal = Math.max(target * 1.4, ...data.map((d) => d.spent), 1);
  const W = 320, H = 180, padL = 8, padR = 8, padT = 10, padB = 22;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const n = data.length, gap = 3;
  const bw = n > 0 ? Math.max(3, innerW / n - gap) : 0;
  const yFor = (v) => padT + innerH - (v / maxVal) * innerH;
  const targetY = yFor(target);
  const totalSpent = data.reduce((s, d) => s + d.spent, 0);
  const avg = data.length ? totalSpent / data.length : 0;

  return (
    <>
      <div style={panel}>
        <div style={label}>Расходы по дням</div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 3, marginBottom: 12 }}>пунктир — ровный лимит {eur(target)}/день</div>
        {n === 0 ? (
          <div style={{ color: C.muted, fontSize: 14, padding: "24px 0", textAlign: "center" }}>Пока нет данных. Внеси первую трату.</div>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
            <line x1={padL} y1={targetY} x2={W - padR} y2={targetY} stroke={"var(--accent, #3B82F6)"} strokeWidth="1" strokeDasharray="4 4" opacity="0.7" />
            {data.map((d, k) => {
              const x = padL + k * (bw + gap);
              const y = yFor(d.spent);
              const h = padT + innerH - y;
              const over = d.spent > target;
              const col = d.spent === 0 ? C.green : over ? C.amber : C.green;
              return (
                <g key={d.date}>
                  <rect x={x} y={d.spent === 0 ? padT + innerH - 2 : y} width={bw} height={d.spent === 0 ? 2 : Math.max(h, 1)} rx="2" fill={col} opacity={d.date === m.today ? 1 : 0.85} />
                  {(k === 0 || k === n - 1 || k % Math.ceil(n / 6) === 0) && (
                    <text x={x + bw / 2} y={H - 8} fill={C.muted} fontSize="8" textAnchor="middle" fontFamily={mono}>{dateFromISO(d.date).getDate()}</text>
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
      <div style={{ ...panel, marginTop: 12 }}>
        <div style={label}>Накопительно против плана</div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 3, marginBottom: 12 }}>линия плана и факт</div>
        <CumulativeChart data={data} target={target} />
      </div>
    </>
  );
}

function CumulativeChart({ data, target }) {
  const W = 320, H = 150, padL = 8, padR = 8, padT = 10, padB = 20;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const n = data.length;
  if (n === 0) return <div style={{ color: C.muted, fontSize: 14, padding: "20px 0", textAlign: "center" }}>Нет данных</div>;
  let cum = 0;
  const actual = data.map((d, k) => { cum += d.spent; return { k, v: cum }; });
  const idealMax = target * n, actualMax = cum;
  const maxV = Math.max(idealMax, actualMax, 1);
  const xFor = (k) => padL + (n === 1 ? innerW / 2 : (k / (n - 1)) * innerW);
  const yFor = (v) => padT + innerH - (v / maxV) * innerH;
  const idealPath = `M ${xFor(0)} ${yFor(target)} L ${xFor(n - 1)} ${yFor(idealMax)}`;
  const actualPts = actual.map((p) => `${xFor(p.k)},${yFor(p.v)}`).join(" ");
  const actualColor = actualMax <= target * n ? C.green : C.red;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
      <line x1={padL} y1={yFor(0)} x2={W - padR} y2={yFor(0)} stroke={C.border} strokeWidth="1" />
      <path d={idealPath} stroke={"var(--accent, #3B82F6)"} strokeWidth="1.5" fill="none" strokeDasharray="4 4" opacity="0.7" />
      <polyline points={actualPts} stroke={actualColor} strokeWidth="2" fill="none" strokeLinejoin="round" strokeLinecap="round" />
      {actual.map((p) => (<circle key={p.k} cx={xFor(p.k)} cy={yFor(p.v)} r={p.k === n - 1 ? 3 : 1.5} fill={actualColor} />))}
    </svg>
  );
}

// ---------- HISTORY ----------
function HistoryView({ period, entries, m, onRemove }) {
  const [open, setOpen] = useState(m.today);
  const weeklyTarget = m.baselineDaily * 7;
  const weeks = useMemo(() => {
    const byDate = {};
    entries.forEach((e) => { (byDate[e.date] ||= []).push(e); });
    const days = Object.entries(byDate).map(([date, list]) => ({
      date, weekIdx: Math.floor(daysBetween(period.startISO, date) / 7),
      total: list.reduce((s, e) => s + e.amount, 0),
      list: [...list].sort((a, b) => (a.id < b.id ? 1 : -1)),
    }));
    const wk = {};
    days.forEach((d) => { (wk[d.weekIdx] ||= []).push(d); });
    return Object.entries(wk).map(([idx, dayList]) => ({
      idx: Number(idx), days: dayList.sort((a, b) => (a.date < b.date ? 1 : -1)),
      total: dayList.reduce((s, d) => s + d.total, 0),
    })).sort((a, b) => b.idx - a.idx);
  }, [entries, period.startISO]);

  if (weeks.length === 0) {
    return (<div style={panel}><div style={label}>История</div>
      <div style={{ color: C.muted, fontSize: 14, padding: "24px 0", textAlign: "center" }}>Пока пусто. Записи появятся здесь по неделям.</div></div>);
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {weeks.map((w) => {
        const wStart = addDays(period.startISO, w.idx * 7);
        const wEnd = addDays(period.startISO, w.idx * 7 + 6);
        const over = w.total > weeklyTarget;
        return (
          <div key={w.idx} style={panel}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
              <div style={label}>Неделя {w.idx + 1}</div>
              <div style={{ fontFamily: mono, fontSize: 18, fontWeight: 700, color: over ? C.amber : C.green }}>{eur(w.total)}</div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: C.muted, marginBottom: 6 }}>
              <span>{prettyDate(wStart)} – {prettyDate(wEnd)}</span><span>лимит {eur(weeklyTarget)}</span>
            </div>
            {w.days.map((d) => {
              const isOpen = open === d.date;
              const dOver = d.total > m.baselineDaily;
              return (
                <div key={d.date} style={{ borderTop: `1px solid ${C.border}` }}>
                  <button onClick={() => setOpen(isOpen ? null : d.date)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 0", background: "none", color: C.text }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ color: C.muted, fontSize: 10, transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▶</span>
                      <span style={{ fontSize: 14 }}>{prettyDate(d.date)}{d.date === m.today ? " · сегодня" : ""}</span>
                    </span>
                    <span style={{ fontFamily: mono, fontSize: 15, color: d.total === 0 ? C.muted : dOver ? C.amber : C.green }}>{eur(d.total)}</span>
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

// ---------- MODALS ----------
function SettingsModal({ period, accent, setAccent, savingsTotal, uid, setConfirm, onReopen, onLogout, onClose, onSave }) {
  const [draft, setDraft] = useState({
    label: period.label, income: period.income || "", totalDays: period.totalDays, startISO: period.startISO,
    obligations: (period.obligations && period.obligations.length ? period.obligations : []),
  });
  const [saving, setSaving] = useState(false);
  const [closed, setClosed] = useState([]);
  useEffect(() => {
    supabase.from("periods").select("*").eq("user_id", uid).eq("status", "closed")
      .order("created_at", { ascending: false })
      .then(({ data }) => setClosed(data || []));
  }, [uid]);
  const inc = parseNum(draft.income) || 0;
  const oblSum = sumObl(draft.obligations);
  const living = inc > 0 ? Math.max(0, inc - oblSum - savingsTotal) : period.livingBudget;

  return (
    <div style={overlay} onClick={onClose}>
      <div style={{ ...modal, maxHeight: "88vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Настройки периода</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 16 }}>Заполни расклад — «на жизнь» посчитается само.</div>

        <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>Акцентный цвет</div>
        <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
          {ACCENTS.map((a) => (
            <button key={a.id} onClick={() => setAccent(a.color)} aria-label={a.id} style={{
              width: 30, height: 30, borderRadius: "50%", background: a.color,
              border: accent === a.color ? "2px solid #fff" : "2px solid transparent",
              boxShadow: accent === a.color ? `0 0 0 2px ${a.color}` : "none", cursor: "pointer" }} />
          ))}
        </div>

        <Field label="Название периода" value={draft.label} type="text" onChange={(v) => setDraft({ ...draft, label: v })} />
        <Field label="Пришло за период, € (баланс/зарплата)" value={draft.income} onChange={(v) => setDraft({ ...draft, income: v })} />

        <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>Обязательные расходы</div>
        <ObligationList items={draft.obligations} onChange={(o) => setDraft({ ...draft, obligations: o })} allowPaid />

        <Field label="Всего дней" value={draft.totalDays} onChange={(v) => setDraft({ ...draft, totalDays: v })} />
        <Field label="Старт (ГГГГ-ММ-ДД)" value={draft.startISO} type="text" onChange={(v) => setDraft({ ...draft, startISO: v })} />

        {inc > 0 && (
          <div style={{ ...panel, padding: 14, marginTop: 4, marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span style={{ color: C.muted }}>Уже в копилке (не трогаем)</span>
              <span style={{ fontFamily: mono, color: C.green }}>−{eur(savingsTotal)}</span>
            </div>
            <div style={{ height: 1, background: C.border, margin: "8px 0" }} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontWeight: 600 }}>На жизнь</span>
              <span style={{ fontFamily: mono, fontWeight: 700, fontSize: 18, color: "var(--accent, #3B82F6)" }}>{eur(living)}</span>
            </div>
          </div>
        )}

        {closed.length > 0 && (
          <div style={{ marginTop: 6, marginBottom: 14, borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>Прошлые периоды</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {closed.map((p) => (
                <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 11, padding: "10px 12px" }}>
                  <div>
                    <div style={{ fontSize: 13.5 }}>{p.label}</div>
                    <div style={{ fontSize: 11, color: C.faint }}>с {prettyDate(p.start_date)} · {p.total_days} дн.</div>
                  </div>
                  <button onClick={() => setConfirm({
                    title: `Вернуть период «${p.label}»?`,
                    message: "Он станет активным, а текущий уйдёт в архив. Данные обоих сохранятся.",
                    confirmText: "Вернуть", onYes: () => onReopen(p.id),
                  })} style={{ ...miniBtn, padding: "8px 12px", fontSize: 12 }}>Сделать активным</button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button onClick={onClose} style={{ ...chip, flex: 1, padding: "12px" }}>Отмена</button>
          <button disabled={saving} onClick={async () => { setSaving(true); await onSave(draft); }} style={{ ...primaryBtn, flex: 1, padding: "12px" }}>{saving ? "…" : "Сохранить"}</button>
        </div>
        <button onClick={() => { onClose(); onLogout(); }} style={{ background: "none", border: "none", color: C.muted, fontSize: 13, width: "100%", marginTop: 14, padding: 6, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <Icon name="logout" size={15} color={C.muted} /> Выйти из аккаунта
        </button>
      </div>
    </div>
  );
}

function GoalPicker({ goals, contribs, onPick, onClose }) {
  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>В какую копилку?</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {goals.map((g) => (
            <button key={g.id} onClick={() => onPick(g.id)} style={{ ...chip, padding: "13px", textAlign: "left", display: "flex", justifyContent: "space-between" }}>
              <span>{g.name}</span>
              <span style={{ fontFamily: mono, color: C.green }}>{eur(goalBalance(g, contribs))}</span>
            </button>
          ))}
        </div>
        <button onClick={onClose} style={{ ...chip, width: "100%", padding: "12px", marginTop: 12 }}>Отмена</button>
      </div>
    </div>
  );
}

function CloseMonthModal({ m, goals, contribs, onClose, onConfirm }) {
  const leftover = Math.max(0, m.remainingBudget);
  const [move, setMove] = useState(leftover ? leftover.toFixed(2) : "");
  const [leftoverGoal, setLeftoverGoal] = useState(goals[0]?.id || "");

  const [label, setLabel] = useState("");
  const [income, setIncome] = useState("");
  const [obligations, setObligations] = useState([]);
  const [days, setDays] = useState("30");
  const [startSavings, setStartSavings] = useState("");
  const [startGoal, setStartGoal] = useState(goals[0]?.id || "");
  const [busy, setBusy] = useState(false);

  const inc = parseNum(income) || 0;
  const oblSum = sumObl(obligations);
  const save = parseNum(startSavings) || 0;
  const living = Math.max(0, inc - oblSum - save);

  const confirm = async () => {
    setBusy(true);
    await onConfirm({
      leftoverMove: parseNum(move) > 0 ? parseNum(move) : 0,
      leftoverGoal: leftoverGoal || null,
      np: { label, income, obligations, days, startSavings, startGoal: startGoal || null },
    });
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={{ ...modal, maxHeight: "90vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Закрыть период</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>Сначала — остаток текущего, потом — расклад нового месяца.</div>

        <div style={{ ...panel, padding: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: C.muted }}>Остаток текущего периода</div>
          <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 24, color: leftover > 0 ? C.green : C.muted, marginTop: 4 }}>{eur(leftover)}</div>
          {goals.length > 0 && leftover > 0 && (
            <div style={{ marginTop: 10 }}>
              <Field label="Отложить остаток в копилку, €" value={move} onChange={setMove} />
              <select value={leftoverGoal} onChange={(e) => setLeftoverGoal(e.target.value)} style={inputStyle}>
                {goals.map((g) => (<option key={g.id} value={g.id}>{g.name} · {eur(goalBalance(g, contribs))}</option>))}
              </select>
            </div>
          )}
        </div>

        <div style={{ ...label, marginBottom: 10 }}>Новый месяц</div>
        <Field label="Название (Сентябрь…)" value={label} type="text" onChange={setLabel} />
        <Field label="Пришла зарплата, €" value={income} onChange={setIncome} />

        <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>Обязательные расходы</div>
        <ObligationList items={obligations} onChange={setObligations} />

        {goals.length > 0 && (
          <div style={{ marginTop: 4 }}>
            <Field label="Сразу в копилку, € (необязательно)" value={startSavings} onChange={setStartSavings} />
            {save > 0 && (
              <select value={startGoal} onChange={(e) => setStartGoal(e.target.value)} style={{ ...inputStyle, marginBottom: 12 }}>
                {goals.map((g) => (<option key={g.id} value={g.id}>{g.name} · {eur(goalBalance(g, contribs))}</option>))}
              </select>
            )}
          </div>
        )}
        <Field label="Дней в периоде" value={days} onChange={setDays} />

        <div style={{ ...panel, padding: 14, marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0" }}>
            <span style={{ color: C.muted }}>Зарплата</span><span style={{ fontFamily: mono }}>{eur(inc)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0" }}>
            <span style={{ color: C.muted }}>− Обязательные</span><span style={{ fontFamily: mono, color: C.red }}>−{eur(oblSum)}</span>
          </div>
          {save > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0" }}>
              <span style={{ color: C.muted }}>− В копилку</span><span style={{ fontFamily: mono, color: C.green }}>−{eur(save)}</span>
            </div>
          )}
          <div style={{ height: 1, background: C.border, margin: "8px 0" }} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontWeight: 600 }}>На жизнь</span>
            <span style={{ fontFamily: mono, fontWeight: 700, fontSize: 18, color: "var(--accent, #3B82F6)" }}>{eur(living)}</span>
          </div>
          <div style={{ textAlign: "right", fontSize: 11.5, color: C.muted, marginTop: 2 }}>≈ {eur(living / (parseInt(days) || 30))}/день</div>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onClose} style={{ ...chip, flex: 1, padding: "12px" }}>Отмена</button>
          <button disabled={busy || inc <= 0} onClick={confirm} style={{ ...primaryBtn, flex: 1, padding: "12px", opacity: inc <= 0 ? 0.5 : 1 }}>{busy ? "…" : "Закрыть и начать"}</button>
        </div>
      </div>
    </div>
  );
}

// ---------- breakdown of income allocation ----------
function BreakdownCard({ period, income, budgetIncome, obligations, extras, ownSavings, oneoffSpent, extraSavings, living, daily }) {
  const [open, setOpen] = useState(false);
  const [openEx, setOpenEx] = useState(false);
  const obl = obligations || [];
  const oblSum = sumObl(obl);
  const ex = extras || [];
  const exSum = sumObl(ex);
  const Row = ({ k, v, c, sign }) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 13.5 }}>
      <span style={{ color: C.muted }}>{k}</span>
      <span style={{ fontFamily: mono, color: c || C.text }}>{sign || ""}{eur(v)}</span>
    </div>
  );
  return (
    <div style={{ ...panel, marginTop: 12 }}>
      <div style={label}>Откуда взялся бюджет</div>
      <div style={{ marginTop: 8 }}>
        <Row k="Пришло за период" v={income} c={C.text} />
        {budgetIncome > 0.005 && <Row k="Поступления в бюджет" v={budgetIncome} c={C.green} sign="+" />}
        <button onClick={() => setOpen(!open)} style={{ width: "100%", background: "none", padding: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 13.5 }}>
            <span style={{ color: C.muted }}>Обязательные {obl.length ? `(${obl.length}) ▾` : ""}</span>
            <span style={{ fontFamily: mono, color: C.red }}>−{eur(oblSum)}</span>
          </div>
        </button>
        {open && obl.map((o, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0 3px 14px", fontSize: 12.5 }}>
            <span style={{ color: C.faint }}>{o.name}{o.paid ? " · оплачено" : ""}</span>
            <span style={{ fontFamily: mono, color: C.faint }}>{eur(parseNum(o.amount) || 0)}</span>
          </div>
        ))}
        {exSum > 0.005 && (
          <>
            <button onClick={() => setOpenEx(!openEx)} style={{ width: "100%", background: "none", padding: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 13.5 }}>
                <span style={{ color: C.muted }}>Разовые расходы ({ex.length}) ▾</span>
                <span style={{ fontFamily: mono, color: C.red }}>−{eur(exSum)}</span>
              </div>
            </button>
            {openEx && ex.map((o, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0 3px 14px", fontSize: 12.5 }}>
                <span style={{ color: C.faint }}>{o.name}{o.date ? ` · ${prettyDate(o.date)}` : ""}</span>
                <span style={{ fontFamily: mono, color: C.faint }}>{eur(parseNum(o.amount) || 0)}</span>
              </div>
            ))}
          </>
        )}
        {ownSavings > 0.005 && <Row k="Отложено в копилку" v={ownSavings} c={C.green} sign="−" />}
        {oneoffSpent > 0.005 && <Row k="Разовое из копилки" v={oneoffSpent} c={C.amber} sign="−" />}
        <div style={{ height: 1, background: C.border, margin: "8px 0" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>На жизнь</span>
          <span style={{ fontFamily: mono, fontWeight: 700, fontSize: 18, color: "var(--accent, #3B82F6)" }}>{eur(living)}</span>
        </div>
        <div style={{ textAlign: "right", fontSize: 11.5, color: C.muted, marginTop: 2 }}>≈ {eur(daily)}/день на {period.totalDays} дн.</div>
        {extraSavings > 0.005 && (
          <div style={{ marginTop: 10, fontSize: 11.5, color: C.faint, lineHeight: 1.4, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
            В копилке есть ещё {eur(extraSavings)} сторонних денег (через «Доходы») — они не из этих {eur(income)} и на дневной лимит не влияют.
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- one-off large expenses card ----------
function OneoffCard({ extras, addExtra, removeExtra, goals, onCharge }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayStr());
  const [src, setSrc] = useState("living");
  const [goalId, setGoalId] = useState(goals && goals[0] ? goals[0].id : "");
  const hasGoals = goals && goals.length > 0;
  const total = sumObl(extras);
  const sorted = [...extras.map((e, i) => ({ ...e, i }))].sort((a, b) => (a.date < b.date ? 1 : -1));

  const submit = async () => {
    if (src === "savings" && goalId) { await onCharge(goalId, amount, name); }
    else { await addExtra(name, amount, date); }
    setName(""); setAmount(""); setDate(todayStr()); setSrc("living"); setAdding(false);
  };

  return (
    <div style={{ ...panel, marginTop: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={label}>Разовые расходы</div>
        {total > 0.005 && <div style={{ fontFamily: mono, fontSize: 15, color: C.red }}>−{eur(total)}</div>}
      </div>
      <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>крупные разовые траты (родители, покупка…) — не входят в дневной лимит</div>

      {sorted.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {sorted.map((e) => (
            <div key={e.i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 0", borderTop: `1px solid ${C.border}` }}>
              <div>
                <div style={{ fontSize: 14 }}>{e.name}</div>
                <div style={{ fontSize: 11, color: C.faint }}>{e.date ? prettyDate(e.date) : ""}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontFamily: mono, fontSize: 15 }}>{eur(parseNum(e.amount) || 0)}</span>
                <button onClick={() => removeExtra(e.i)} style={delBtn}>удалить</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!adding ? (
        <button onClick={() => setAdding(true)} style={{ ...miniBtn, width: "100%", padding: "11px", marginTop: 12 }}>+ Разовый расход</button>
      ) : (
        <div style={{ marginTop: 12 }}>
          <input type="text" placeholder="На что (Родители, билеты…)" value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <input type="number" inputMode="decimal" placeholder="Сумма, €" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ ...inputStyle, flex: 1, fontFamily: mono }} />
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
          </div>
          {hasGoals && (
            <>
              <div style={{ fontSize: 12, color: C.muted, margin: "12px 0 6px" }}>Откуда списать</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setSrc("living")} style={{ ...miniBtn, flex: 1, padding: "11px", background: src === "living" ? "var(--accent, #3B82F6)" : C.surface2, color: src === "living" ? "#fff" : C.text, borderColor: src === "living" ? "transparent" : C.border }}>Из денег на жизнь</button>
                <button onClick={() => setSrc("savings")} style={{ ...miniBtn, flex: 1, padding: "11px", background: src === "savings" ? "var(--accent, #3B82F6)" : C.surface2, color: src === "savings" ? "#fff" : C.text, borderColor: src === "savings" ? "transparent" : C.border }}>Из копилки</button>
              </div>
              {src === "savings" && (
                <>
                  {goals.length > 1 && (
                    <select value={goalId} onChange={(e) => setGoalId(e.target.value)} style={{ ...inputStyle, marginTop: 8 }}>
                      {goals.map((g) => (<option key={g.id} value={g.id}>{g.name}</option>))}
                    </select>
                  )}
                  <div style={{ fontSize: 11.5, color: C.faint, marginTop: 8, lineHeight: 1.4 }}>Спишется из накопления и не тронет дневную еду. Появится в «Копилке» и «Ленте».</div>
                </>
              )}
            </>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button onClick={() => { setAdding(false); setName(""); setAmount(""); setSrc("living"); }} style={{ ...chip, flex: 1, padding: "11px" }}>Отмена</button>
            <button onClick={submit} style={{ ...primaryBtn, flex: 1, padding: "11px" }}>Добавить</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- editable list of obligations ----------
function ObligationList({ items, onChange, allowPaid }) {
  const upd = (i, field, val) => { const c = items.map((o, k) => k === i ? { ...o, [field]: val } : o); onChange(c); };
  const add = () => onChange([...items, { name: "", amount: "" }]);
  const rm = (i) => onChange(items.filter((_, k) => k !== i));
  return (
    <div>
      {items.map((o, i) => (
        <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
          <input type="text" placeholder="Название" value={o.name} onChange={(e) => upd(i, "name", e.target.value)}
            style={{ ...inputStyle, flex: 1, fontSize: 14, padding: "10px 12px" }} />
          <input type="number" inputMode="decimal" placeholder="€" value={o.amount} onChange={(e) => upd(i, "amount", e.target.value)}
            style={{ ...inputStyle, width: 78, fontSize: 14, padding: "10px 12px", fontFamily: mono }} />
          {allowPaid && (
            <button onClick={() => upd(i, "paid", !o.paid)} aria-label="Оплачено" title="Отметить оплаченным"
              style={{ ...miniBtn, padding: "0 11px", display: "flex", alignItems: "center",
                background: o.paid ? "#12241C" : C.surface2, borderColor: o.paid ? "#1E4436" : C.border }}>
              <Icon name="check" size={15} color={o.paid ? C.green : C.faint} />
            </button>
          )}
          <button onClick={() => rm(i)} style={{ ...miniBtn, padding: "0 11px", display: "flex", alignItems: "center", color: C.red, borderColor: "#3a2626" }} aria-label="Убрать"><Icon name="close" size={15} color={C.red} /></button>
        </div>
      ))}
      <button onClick={add} style={{ ...miniBtn, width: "100%", padding: "10px", marginTop: 2 }}>+ строка</button>
      {allowPaid && items.length > 0 && (
        <div style={{ fontSize: 11.5, color: C.faint, marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}>
          <Icon name="check" size={13} color={C.green} /> — уже оплачено, деньги ушли со счёта
        </div>
      )}
    </div>
  );
}

// ---------- ALL · balance + operations feed ----------
function AllView({ period, entries, incomes, m, savingsTotal }) {
  const obligations = period.obligations || [];
  const extras = period.extras || [];
  const pending = incomes.filter((i) => i.status === "pending").reduce((s, i) => s + i.amount, 0);
  const reservedObl = sumObl(obligations.filter((o) => !o.paid));
  const total = savingsTotal + reservedObl + m.remainingBudget + pending;

  const feed = [
    ...entries.map((e) => ({ kind: "spend", date: e.date, amount: -e.amount, title: "Трата" })),
    ...extras.map((e) => ({ kind: "extra", date: e.date, amount: -(parseNum(e.amount) || 0), title: e.name || "Разовый расход" })),
    ...incomes.map((i) => ({ kind: "income", date: i.date, amount: i.amount, title: i.source || "Поступление", status: i.status })),
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const tagFor = (f) => f.kind === "extra" ? "разовый"
    : f.kind === "income" ? (f.status === "budget" ? "в бюджет" : f.status === "savings" ? "в копилку" : "не распределено")
    : null;

  return (
    <>
      <BalanceCard total={total} savings={savingsTotal} obligations={reservedObl}
        living={m.remainingBudget} pending={pending} hasIncome={period.income > 0} />

      <div style={{ ...panel, marginTop: 12 }}>
        <div style={label}>Все операции</div>
        {feed.length === 0 ? (
          <div style={{ color: C.muted, fontSize: 14, padding: "22px 0", textAlign: "center", lineHeight: 1.5 }}>Здесь соберутся все движения —<br />траты, доходы и разовые расходы.</div>
        ) : feed.map((f, idx) => (
          <div key={idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderTop: `1px solid ${C.border}` }}>
            <div>
              <div style={{ fontSize: 14 }}>{f.title}</div>
              <div style={{ fontSize: 11, color: C.faint }}>{prettyDate(f.date)}{tagFor(f) ? ` · ${tagFor(f)}` : ""}</div>
            </div>
            <span style={{ fontFamily: mono, fontSize: 15, color: f.amount >= 0 ? C.green : C.text }}>{signEur(f.amount)}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function BalanceCard({ total, savings, obligations, living, pending, hasIncome }) {
  const [bank, setBank] = useState("");
  const b = parseNum(bank);
  const diff = isFinite(b) ? b - total : null;
  const Row = ({ k, v, c }) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 13.5 }}>
      <span style={{ color: C.muted }}>{k}</span>
      <span style={{ fontFamily: mono, color: c || C.text }}>{eur(v)}</span>
    </div>
  );
  return (
    <div style={panel}>
      <div style={label}>Текущий баланс</div>
      <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 34, marginTop: 8, letterSpacing: -0.5 }}>{eur(total)}</div>
      <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>столько должно быть на счету</div>

      {!hasIncome && (
        <div style={{ fontSize: 12, color: C.amber, marginTop: 10 }}>Заполни «Пришло за период» в настройках, чтобы баланс считался точно.</div>
      )}

      <div style={{ marginTop: 12, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
        <Row k="В копилках" v={savings} c={C.green} />
        <Row k="Под обязательные" v={obligations} />
        <Row k="Остаток на жизнь" v={living} c={living < 0 ? C.red : C.text} />
        {pending > 0.005 && <Row k="Не распределено" v={pending} c={C.amber} />}
      </div>

      <div style={{ marginTop: 14, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>Сверить с банком</div>
        <input type="number" inputMode="decimal" placeholder="Баланс в банке, €" value={bank}
          onChange={(e) => setBank(e.target.value)} style={inputStyle} />
        {diff !== null && (
          Math.abs(diff) < 0.01 ? (
            <div style={{ fontSize: 13, color: C.green, marginTop: 8 }}>✓ Сходится с банком</div>
          ) : (
            <div style={{ fontSize: 12.5, color: C.amber, marginTop: 8, lineHeight: 1.4 }}>
              Расхождение: <b style={{ fontFamily: mono }}>{signEur(diff)}</b><br />
              {diff < 0
                ? "в банке меньше — вероятно, есть незаписанная трата или уже оплаченное обязательное."
                : "в банке больше — возможно, пришли деньги, не занесённые в «Доходы»."}
            </div>
          )
        )}
      </div>
    </div>
  );
}

// ---------- FEED screen (лента + баланс + календарь + график) ----------
function FeedScreen({ feedSub, setFeedSub, period, entries, incomes, contribs, m, savingsTotal, onRemove, addExtra, removeExtra, goals, chargeToGoal, onCloseMonth }) {
  const [open, setOpen] = useState(null); // breakdown | oneoff | forecast | cal | chart | balance
  const obligations = period.obligations || [];
  const extras = period.extras || [];
  const pending = incomes.filter((i) => i.status === "pending").reduce((s, i) => s + i.amount, 0);
  const reservedObl = sumObl(obligations.filter((o) => !o.paid));
  const total = savingsTotal + reservedObl + m.remainingBudget + pending;
  const oneoffTotal = sumObl(extras) + m.oneoffSpent;

  const feed = [
    ...entries.map((e) => ({ kind: "spend", date: e.date, amount: -e.amount, title: "Трата" })),
    ...extras.map((e) => ({ kind: "extra", date: e.date, amount: -(parseNum(e.amount) || 0), title: e.name || "Разовый расход" })),
    ...(contribs || []).filter((c) => c.source === "oneoff").map((c) => ({ kind: "oneoff", date: (c.createdAt || "").slice(0, 10) || m.today, amount: c.amount, title: c.note || "Разовое из копилки" })),
    ...incomes.map((i) => ({ kind: "income", date: i.date, amount: i.amount, title: i.source || "Поступление", status: i.status })),
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const tagFor = (f) => f.kind === "extra" ? "разовый"
    : f.kind === "oneoff" ? "из копилки"
    : f.kind === "income" ? (f.status === "budget" ? "в бюджет" : f.status === "savings" ? "в копилку" : "не распределено") : null;

  const Tile = ({ id, title, value, color, sub }) => (
    <button onClick={() => setOpen(id)} style={{
      background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16,
      padding: "14px 13px", textAlign: "left", cursor: "pointer", color: C.text,
    }}>
      <div style={{ fontSize: 10.5, letterSpacing: 1, textTransform: "uppercase", color: C.muted }}>{title}</div>
      <div style={{ fontFamily: mono, fontSize: 19, fontWeight: 700, color: color || C.text, marginTop: 6, whiteSpace: "nowrap" }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: C.faint, marginTop: 3 }}>{sub}</div>}
    </button>
  );

  const closeModal = () => setOpen(null);
  const Sheet = ({ title, children }) => (
    <div style={{ ...overlay, alignItems: "flex-end", padding: 0 }} onClick={closeModal}>
      <div style={{ ...sheet, maxHeight: "86vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{title}</div>
          <button onClick={closeModal} style={{ ...miniBtn, padding: "7px 10px", display: "flex" }}><Icon name="close" size={15} color={C.muted} /></button>
        </div>
        {children}
      </div>
    </div>
  );

  return (
    <>
      {/* compact balance strip */}
      <button onClick={() => setOpen("balance")} style={{ ...panel, width: "100%", textAlign: "left", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", color: C.text }}>
        <div>
          <div style={label}>Текущий баланс</div>
          <div style={{ fontFamily: mono, fontSize: 26, fontWeight: 700, marginTop: 4 }}>{eur(total)}</div>
        </div>
        <div style={{ fontSize: 11, color: C.faint, textAlign: "right", lineHeight: 1.5 }}>
          копилка {eur(savingsTotal)}<br />жизнь {eur(m.remainingBudget)}
        </div>
      </button>

      {/* tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
        <Tile id="breakdown" title="Расклад" value={eur(m.effectiveLiving)} sub={`на жизнь · ${eur(m.dailyNow)}/день`} />
        <Tile id="forecast" title="Прогноз" value={eur(m.projectedLeftover)} color={m.projectedLeftover < 0 ? C.red : C.green} sub="остаток к концу" />
        <Tile id="oneoff" title="Разовые" value={oneoffTotal > 0.005 ? "−" + eur(oneoffTotal) : "0 €"} color={oneoffTotal > 0.005 ? C.amber : C.muted} sub={`${extras.length + (contribs || []).filter((c) => c.source === "oneoff").length} шт.`} />
        <Tile id="cal" title="Календарь" value={prettyDate(m.today)} sub="дни месяца" />
        <Tile id="chart" title="График" value={eur(m.totalSpent)} sub="всего потрачено" />
        <button onClick={onCloseMonth} style={{
          background: C.surface2, border: `1px dashed ${C.border}`, borderRadius: 16,
          padding: "14px 13px", textAlign: "left", cursor: "pointer",
        }}>
          <div style={{ fontSize: 10.5, letterSpacing: 1, textTransform: "uppercase", color: C.muted }}>Период</div>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: C.text, marginTop: 7 }}>Закрыть месяц →</div>
        </button>
      </div>

      {/* operations */}
      <div style={{ ...panel, marginTop: 12 }}>
        <div style={label}>Все операции</div>
        {feed.length === 0 ? (
          <div style={{ color: C.muted, fontSize: 14, padding: "22px 0", textAlign: "center", lineHeight: 1.5 }}>Здесь соберутся все движения —<br />траты, доходы и разовые расходы.</div>
        ) : feed.map((f, idx) => (
          <div key={idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderTop: `1px solid ${C.border}` }}>
            <div>
              <div style={{ fontSize: 14 }}>{f.title}</div>
              <div style={{ fontSize: 11, color: C.faint }}>{prettyDate(f.date)}{tagFor(f) ? ` · ${tagFor(f)}` : ""}</div>
            </div>
            <span style={{ fontFamily: mono, fontSize: 15, color: f.amount >= 0 ? C.green : C.text }}>{signEur(f.amount)}</span>
          </div>
        ))}
      </div>

      {/* modals */}
      {open === "balance" && (
        <Sheet title="Текущий баланс">
          <BalanceCard total={total} savings={savingsTotal} obligations={reservedObl}
            living={m.remainingBudget} pending={pending} hasIncome={period.income > 0} />
        </Sheet>
      )}
      {open === "breakdown" && (
        <Sheet title="Откуда взялся бюджет">
          <BreakdownCard period={period} income={period.income} budgetIncome={m.budgetIncome}
            obligations={period.obligations} extras={period.extras} ownSavings={m.reservedSavings}
            oneoffSpent={m.oneoffSpent} extraSavings={Math.max(0, savingsTotal - m.reservedSavings)}
            living={m.effectiveLiving} daily={m.dailyNow} />
        </Sheet>
      )}
      {open === "oneoff" && (
        <Sheet title="Разовые расходы">
          <OneoffCard extras={period.extras || []} addExtra={addExtra} removeExtra={removeExtra}
            goals={goals} onCharge={chargeToGoal} />
        </Sheet>
      )}
      {open === "forecast" && (
        <Sheet title="Прогноз">
          <div style={panel}>
            <div style={{ fontSize: 12, color: C.muted }}>Остаток к концу периода — это можно будет отложить в копилку</div>
            <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 34, color: m.projectedLeftover < 0 ? C.red : "var(--accent, #3B82F6)", marginTop: 8, letterSpacing: -0.5 }}>
              {eur(m.projectedLeftover)}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              <MiniStat label={`Осталось из ${eur(m.effectiveLiving)}`} value={eur(m.remainingBudget)} color={m.remainingBudget < 0 ? C.red : C.text} />
              <MiniStat label="Прогноз трат" value={eur(m.projectedTotal)} color={C.text} />
            </div>
          </div>
        </Sheet>
      )}
      {open === "cal" && (
        <Sheet title="Календарь">
          <CalendarView period={period} entries={entries} m={m} />
        </Sheet>
      )}
      {open === "chart" && (
        <Sheet title="График">
          <ChartView period={period} entries={entries} m={m} />
        </Sheet>
      )}
    </>
  );
}

// ---------- CALENDAR heatmap ----------
function CalendarView({ period, entries, m }) {
  const [sel, setSel] = useState(m.today);
  const base = m.baselineDaily;
  const now = dateFromISO(m.today);
  const year = now.getFullYear(), month = now.getMonth();
  const startWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const dayData = (iso) => entries.filter((e) => e.date === iso).reduce((s, e) => s + e.amount, 0);
  const colorFor = (iso, spent) => {
    if (iso > m.today) return null;
    const r = base > 0 ? spent / base : 0;
    return r > 1 ? C.red : r > 0.75 ? C.amber : C.green;
  };
  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${year}-${pad(month + 1)}-${pad(d)}`);
  const selSpent = dayData(sel);
  const selCol = colorFor(sel, selSpent);

  return (
    <div style={panel}>
      <div style={label}>{RU_MONTHS[month]} · расходы по дням</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 5, marginTop: 12 }}>
        {["пн", "вт", "ср", "чт", "пт", "сб", "вс"].map((w) => (
          <div key={w} style={{ fontSize: 9, color: C.faint, textAlign: "center" }}>{w}</div>
        ))}
        {cells.map((iso, i) => {
          if (!iso) return <div key={i} />;
          const spent = dayData(iso);
          const col = colorFor(iso, spent);
          const dnum = Number(iso.slice(-2));
          const isToday = iso === m.today;
          const isSel = iso === sel;
          return (
            <button key={i} onClick={() => setSel(iso)} style={{
              aspectRatio: "1", borderRadius: 8, fontFamily: mono, fontSize: 11,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: col ? col + "2e" : C.surface2,
              border: isSel ? "2px solid #fff" : isToday ? `1px solid ${C.muted}` : `1px solid ${col ? col + "55" : C.border}`,
              color: col || C.faint,
            }}>{dnum}</button>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 12, fontSize: 10, color: C.muted }}>
        <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: C.green, marginRight: 4 }} />норма</span>
        <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: C.amber, marginRight: 4 }} />впритык</span>
        <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: C.red, marginRight: 4 }} />перебор</span>
      </div>
      <div style={{ marginTop: 14, borderTop: `1px solid ${C.border}`, paddingTop: 12, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{prettyDate(sel)}{sel === m.today ? " · сегодня" : ""}</div>
        <div style={{ fontFamily: mono, fontSize: 16, color: selCol || C.muted }}>{sel > m.today ? "—" : eur(selSpent)}</div>
      </div>
    </div>
  );
}

// ---------- ADD sheet (единая точка ввода) ----------
function AddSheet({ onAdd, onAddExtra, onCharge, goals, onClose }) {
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState("day");   // day | oneoff | savings
  const [name, setName] = useState("");
  const [goalId, setGoalId] = useState(goals && goals[0] ? goals[0].id : "");
  const hasGoals = goals && goals.length > 0;

  const submit = () => {
    const n = parseNum(amount); if (!isFinite(n) || n <= 0) return;
    if (kind === "day") onAdd(n);
    else if (kind === "oneoff") onAddExtra(name, n, todayStr());
    else if (kind === "savings" && goalId) onCharge(goalId, n, name);
    onClose();
  };

  const opt = (k, title, subtitle) => (
    <button onClick={() => setKind(k)} style={{
      flex: 1, background: kind === k ? "var(--accent, #3B82F6)" : C.surface2,
      border: `1px solid ${kind === k ? "transparent" : C.border}`, borderRadius: 12,
      padding: "10px 6px", color: kind === k ? "#fff" : C.text, textAlign: "center",
    }}>
      <div style={{ fontSize: 13, fontWeight: 700 }}>{title}</div>
      <div style={{ fontSize: 10, marginTop: 2, color: kind === k ? "rgba(255,255,255,.75)" : C.faint }}>{subtitle}</div>
    </button>
  );

  return (
    <div style={{ ...overlay, alignItems: "flex-end", padding: 0 }} onClick={onClose}>
      <div style={sheet} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>Записать трату</div>
        <input type="number" inputMode="decimal" placeholder="0,00" autoFocus value={amount}
          onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()}
          style={{ ...inputStyle, fontSize: 24, fontWeight: 700, fontFamily: mono, textAlign: "center" }} />
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          {[3, 5, 10, 15].map((v) => (
            <button key={v} onClick={() => setAmount(String((parseNum(amount) || 0) + v))} style={{ ...chip, flex: 1, textAlign: "center" }}>+{v}</button>
          ))}
        </div>

        <div style={{ fontSize: 12, color: C.muted, margin: "16px 0 8px" }}>Из каких денег?</div>
        <div style={{ display: "flex", gap: 8 }}>
          {opt("day", "Еда на день", "дневной лимит")}
          {opt("oneoff", "Разовое", "крупное, не еда")}
          {hasGoals && opt("savings", "Из копилки", "не тронет еду")}
        </div>

        {kind !== "day" && (
          <input type="text" placeholder="На что? (билеты, родители…)" value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ ...inputStyle, marginTop: 10, fontSize: 15 }} />
        )}
        {kind === "savings" && goals.length > 1 && (
          <select value={goalId} onChange={(e) => setGoalId(e.target.value)} style={{ ...inputStyle, marginTop: 8 }}>
            {goals.map((g) => (<option key={g.id} value={g.id}>{g.name}</option>))}
          </select>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={{ ...chip, flex: 1, padding: "14px" }}>Отмена</button>
          <button onClick={submit} style={{ ...primaryBtn, flex: 2, padding: "14px" }}>+ Добавить</button>
        </div>
      </div>
    </div>
  );
}

// ---------- icons ----------
function Icon({ name, size = 18, color = "currentColor", style }) {
  const paths = {
    gear: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>,
    logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></>,
    edit: <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></>,
    close: <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>,
    plus: <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>,
    check: <polyline points="20 6 9 17 4 12" />,
    trash: <><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>,
    home: <><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></>,
    list: <><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></>,
    target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /></>,
    income: <><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style}>
      {paths[name]}
    </svg>
  );
}

// ---------- confirm dialog ----------
function ConfirmModal({ title, message, confirmText = "Да", danger, onYes, onClose }) {
  return (
    <div style={overlay} onClick={onClose}>
      <div style={{ ...modal, maxWidth: 340 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>{title}</div>
        {message && <div style={{ fontSize: 13.5, color: C.muted, lineHeight: 1.45, marginBottom: 16 }}>{message}</div>}
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onClose} style={{ ...chip, flex: 1, padding: "12px" }}>Отмена</button>
          <button onClick={() => { onYes(); onClose(); }}
            style={{ ...primaryBtn, flex: 1, padding: "12px", background: danger ? C.red : "var(--accent, #3B82F6)" }}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- small ----------
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
  maxWidth: 460, margin: "0 auto", padding: "calc(20px + env(safe-area-inset-top)) 16px calc(96px + env(safe-area-inset-bottom))",
  display: "flex", flexDirection: "column" };
const panel = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 18, padding: 18 };
const label = { fontSize: 12, letterSpacing: 1.5, color: C.muted, textTransform: "uppercase" };
const iconBtn = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 11, color: C.muted, width: 42, height: 42, display: "flex", alignItems: "center", justifyContent: "center" };
const chip = { background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 11, color: C.text, fontWeight: 600, fontSize: 14, padding: "10px 14px" };
const miniBtn = { background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 11, color: C.text, fontWeight: 600, fontSize: 13, padding: "10px 14px" };
const rowItem = { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 0", borderTop: `1px solid ${C.border}` };
const delBtn = { background: "transparent", border: "none", color: C.red, fontSize: 12 };
const inputStyle = { width: "100%", background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 12, color: C.text, fontFamily: sans, padding: "12px 14px", fontSize: 16 };
const primaryBtn = { background: "var(--accent, #3B82F6)", border: "none", borderRadius: 11, color: "#fff", fontWeight: 700, fontSize: 14 };
const tabBar = { display: "flex", gap: 5, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 13, padding: 4 };
const tabBtn = (active, small) => ({ flex: 1, padding: small ? "8px" : "10px", borderRadius: 10, fontWeight: 500,
  fontSize: small ? 13 : 14, background: active ? "var(--accent, #3B82F6)" : "transparent", color: active ? "#fff" : C.muted, transition: "background .15s" });
const overlay = { position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 50 };
const modal = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 18, padding: 20, width: "100%", maxWidth: 380 };
const navBar = { position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 460,
  height: "calc(62px + env(safe-area-inset-bottom))", paddingBottom: "env(safe-area-inset-bottom)",
  background: "rgba(17,20,26,.94)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)",
  borderTop: `1px solid ${C.border}`, display: "flex", alignItems: "center", zIndex: 40 };
const navItem = (active) => ({ flex: 1, background: "none", border: "none", cursor: "pointer",
  color: active ? "var(--accent, #3B82F6)" : C.faint, display: "flex", flexDirection: "column",
  alignItems: "center", gap: 3, fontSize: 10, fontWeight: 500, padding: "6px 0", height: 62, justifyContent: "center" });
const fabStyle = { position: "fixed", bottom: "calc(26px + env(safe-area-inset-bottom))", left: "50%", transform: "translateX(-50%)",
  width: 56, height: 56, borderRadius: "50%", background: "var(--accent, #3B82F6)", border: "3px solid " + C.bg,
  color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
  boxShadow: "0 8px 20px rgba(59,130,246,.4)", zIndex: 41, cursor: "pointer" };
const sheet = { width: "100%", maxWidth: 460, background: C.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22,
  borderTop: `1px solid ${C.border}`, padding: "20px 18px calc(26px + env(safe-area-inset-bottom))", margin: "0 auto" };