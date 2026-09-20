import { useEffect, useMemo, useState } from "react";
import "./styles.css";

/* ---------- 基础数据模型 ---------- */

interface Circuit {
  id: string;
  name: string;
  rated: number;
  note: string;
}

interface Fixture {
  id: string;
  name: string;
  watts: number;
  gel: string;
  focus: string;
}

interface Assignment {
  uid: string;
  fixtureId: string;
  circuitId: string;
  channel: number;
  watts: number;
  gel: string;
  focus: string;
}

interface ShowSession {
  id: string;
  name: string;
  locked: boolean;
  rows: Assignment[];
}

interface DraftRow {
  key: string;
  fixtureId: string;
  circuitId: string;
  channel: string;
  watts: string;
  gel: string;
  focus: string;
}

interface Banner {
  type: "error" | "success";
  lines: string[];
}

/* ---------- 预置：四个回路 ---------- */

const CIRCUITS: Circuit[] = [
  { id: "C1", name: "面光回路", rated: 2000, note: "台口面光桥" },
  { id: "C2", name: "左侧光回路", rated: 1800, note: "上场门侧光吊笼" },
  { id: "C3", name: "右侧光回路", rated: 1800, note: "下场门侧光吊笼" },
  { id: "C4", name: "逆光回路", rated: 2400, note: "顶光吊杆三道" },
];

/* ---------- 预置：六台灯具 ---------- */

const FIXTURES: Fixture[] = [
  { id: "F-101", name: "螺纹聚光灯", watts: 750, gel: "L201 中蓝", focus: "台口正中" },
  { id: "F-102", name: "平凸聚光灯", watts: 1000, gel: "L205 浅蓝", focus: "上场门三道" },
  { id: "F-201", name: "成像灯", watts: 575, gel: "L117 粉红", focus: "下场门定点" },
  { id: "F-202", name: "成像灯", watts: 750, gel: "L164 日光蓝", focus: "舞台后区" },
  { id: "F-301", name: "P64 帕灯", watts: 1000, gel: "L101 金黄", focus: "天幕铺光" },
  { id: "F-302", name: "LED 摇头染色灯", watts: 400, gel: "L135 深蓝", focus: "台唇流动" },
];

const FIXTURE_MAP = new Map(FIXTURES.map((f) => [f.id, f]));
const CIRCUIT_MAP = new Map(CIRCUITS.map((c) => [c.id, c]));

const STORAGE_KEY = "lamp-circuit-load-desk-v1";

function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function fmtCh(channel: number): string {
  return String(channel).padStart(3, "0");
}

/* ---------- 预置场次 ---------- */

function seedSessions(): ShowSession[] {
  return [
    {
      id: uid(),
      name: "首演场",
      locked: true,
      rows: [
        { uid: uid(), fixtureId: "F-101", circuitId: "C1", channel: 1, watts: 750, gel: "L201 中蓝", focus: "台口正中" },
        { uid: uid(), fixtureId: "F-201", circuitId: "C3", channel: 5, watts: 575, gel: "L117 粉红", focus: "下场门定点" },
        { uid: uid(), fixtureId: "F-301", circuitId: "C4", channel: 12, watts: 1000, gel: "L101 金黄", focus: "天幕铺光" },
      ],
    },
    {
      id: uid(),
      name: "彩排场",
      locked: false,
      rows: [
        { uid: uid(), fixtureId: "F-102", circuitId: "C2", channel: 2, watts: 1000, gel: "L205 浅蓝", focus: "上场门三道" },
        { uid: uid(), fixtureId: "F-202", circuitId: "C4", channel: 18, watts: 750, gel: "L164 日光蓝", focus: "舞台后区" },
      ],
    },
  ];
}

/* ---------- 本地存取 ---------- */

interface PersistShape {
  sessions: ShowSession[];
  selectedId: string | null;
}

function isValidSession(raw: unknown): raw is ShowSession {
  if (typeof raw !== "object" || raw === null) return false;
  const s = raw as Record<string, unknown>;
  return (
    typeof s.id === "string" &&
    typeof s.name === "string" &&
    typeof s.locked === "boolean" &&
    Array.isArray(s.rows) &&
    s.rows.every(
      (r) =>
        typeof r === "object" &&
        r !== null &&
        typeof (r as Assignment).uid === "string" &&
        typeof (r as Assignment).fixtureId === "string" &&
        typeof (r as Assignment).circuitId === "string" &&
        typeof (r as Assignment).channel === "number" &&
        typeof (r as Assignment).watts === "number"
    )
  );
}

function loadPersisted(): PersistShape {
  const fallback = (): PersistShape => {
    const sessions = seedSessions();
    return { sessions, selectedId: sessions[0].id };
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback();
    const parsed = JSON.parse(raw) as Partial<PersistShape>;
    if (!parsed || !Array.isArray(parsed.sessions) || !parsed.sessions.every(isValidSession)) {
      return fallback();
    }
    const sessions = parsed.sessions;
    const selectedId =
      typeof parsed.selectedId === "string" && sessions.some((s) => s.id === parsed.selectedId)
        ? parsed.selectedId
        : sessions[0].id;
    return { sessions, selectedId };
  } catch {
    return fallback();
  }
}

/* ---------- 校验规则 ---------- */

/** 整批排入校验：回路功率 + 通道占用；返回全部违规说明（空数组 = 通过） */
function commitErrors(target: ShowSession, staged: DraftRow[], all: ShowSession[]): string[] {
  const errors: string[] = [];
  const incoming: Assignment[] = staged.map((d) => ({
    uid: d.key,
    fixtureId: d.fixtureId,
    circuitId: d.circuitId,
    channel: Number(d.channel),
    watts: Number(d.watts),
    gel: d.gel.trim(),
    focus: d.focus.trim(),
  }));
  const trial = [...target.rows, ...incoming];

  // 规则一：同一回路总功率不得超过额定负载
  CIRCUITS.forEach((c) => {
    const used = trial.filter((r) => r.circuitId === c.id).reduce((sum, r) => sum + r.watts, 0);
    if (used > c.rated) {
      errors.push(
        `「${c.name}」排入后合计 ${used}W，超过额定负载 ${c.rated}W（超限 ${used - c.rated}W）。`
      );
    }
  });

  // 场次内部同一通道不得重复
  const seenInTrial = new Map<number, string>();
  trial.forEach((r) => {
    const prev = seenInTrial.get(r.channel);
    if (prev) {
      errors.push(`通道 CH${fmtCh(r.channel)} 在本场次内重复：${prev} 与 ${r.fixtureId} 不能共用。`);
    } else {
      seenInTrial.set(r.channel, r.fixtureId);
    }
  });

  // 规则二：不能与已锁定的冲突场次共用通道
  const occupied = new Map<number, string>();
  all
    .filter((s) => s.locked && s.id !== target.id)
    .forEach((s) => s.rows.forEach((r) => occupied.set(r.channel, s.name)));
  incoming.forEach((r) => {
    const holder = occupied.get(r.channel);
    if (holder) {
      errors.push(`灯具 ${r.fixtureId} 的通道 CH${fmtCh(r.channel)} 已被锁定场次「${holder}」占用。`);
    }
  });

  return errors;
}

/** 锁定前校验：本场所用通道不得与其他已锁定场次冲突 */
function lockErrors(target: ShowSession, all: ShowSession[]): string[] {
  const errors: string[] = [];
  const occupied = new Map<number, string>();
  all
    .filter((s) => s.locked && s.id !== target.id)
    .forEach((s) => s.rows.forEach((r) => occupied.set(r.channel, s.name)));
  const own = new Set<number>();
  target.rows.forEach((r) => {
    const holder = occupied.get(r.channel);
    if (holder) errors.push(`CH${fmtCh(r.channel)} 与已锁定场次「${holder}」冲突，无法锁定本场次。`);
    if (own.has(r.channel)) errors.push(`CH${fmtCh(r.channel)} 在本场次内重复，无法锁定。`);
    own.add(r.channel);
  });
  return errors;
}

/* ---------- 组件 ---------- */

function emptyDraft(): DraftRow {
  const f = FIXTURES[0];
  return {
    key: uid(),
    fixtureId: f.id,
    circuitId: CIRCUITS[0].id,
    channel: "",
    watts: String(f.watts),
    gel: f.gel,
    focus: f.focus,
  };
}

function App() {
 const initial = useMemo(loadPersisted, []);
  const [sessions, setSessions] = useState<ShowSession[]>(initial.sessions);
  const [selectedId, setSelectedId] = useState<string | null>(initial.selectedId);
  const [draft, setDraft] = useState<DraftRow>(emptyDraft);
  const [staged, setStaged] = useState<DraftRow[]>([]);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [newName, setNewName] = useState("");

  const selected = sessions.find((s) => s.id === selectedId) ?? sessions[0];

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessions, selectedId }));
  }, [sessions, selectedId]);

  /* ----- 统计 ----- */

  const usage = useMemo(() => {
    const map = new Map<string, number>();
    CIRCUITS.forEach((c) => map.set(c.id, 0));
    selected.rows.forEach((r) => map.set(r.circuitId, (map.get(r.circuitId) ?? 0) + r.watts));
    return map;
  }, [selected]);

  const totalWatts = selected.rows.reduce((s, r) => s + r.watts, 0);

  const topLoad = useMemo(() => {
    let top = { circuit: CIRCUITS[0], percent: 0 };
    CIRCUITS.forEach((c) => {
      const percent = (usage.get(c.id) ?? 0) / c.rated;
      if (percent > top.percent) top = { circuit: c, percent };
    });
    return top;
  }, [usage]);

  const lockedSessions = sessions.filter((s) => s.locked);
  const lockedChannels = useMemo(() => {
    const map = new Map<number, string>();
    lockedSessions.forEach((s) => s.rows.forEach((r) => map.set(r.channel, s.name)));
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions]);

  /* ----- 操作 ----- */

  function pickFixture(fixtureId: string) {
    const f = FIXTURE_MAP.get(fixtureId);
    setDraft((d) => ({
      ...d,
      fixtureId,
      watts: f ? String(f.watts) : d.watts,
      gel: f ? f.gel : d.gel,
      focus: f ? f.focus : d.focus,
    }));
  }

  function addToStaged() {
    const errors: string[] = [];
    const channel = Number(draft.channel);
    const watts = Number(draft.watts);
    if (!Number.isInteger(channel) || channel < 1 || channel > 512)
      errors.push("通道需为 1–512 的整数。");
    if (!Number.isFinite(watts) || watts <= 0) errors.push("功率需为大于 0 的数字（W）。");
    if (!draft.gel.trim()) errors.push("请填写色片。");
    if (!draft.focus.trim()) errors.push("请填写焦点。");
    if (!CIRCUIT_MAP.has(draft.circuitId)) errors.push("请选择回路。");
    if (errors.length > 0) {
      setBanner({ type: "error", lines: ["待排灯具信息不完整：", ...errors] });
      return;
    }
    setStaged((list) => [...list, { ...draft, channel: String(channel), watts: String(watts) }]);
    setDraft(emptyDraft());
    setBanner(null);
  }

  function commit() {
    if (selected.locked || staged.length === 0) return;
    const errors = commitErrors(selected, staged, sessions);
    if (errors.length > 0) {
      // 任一违规：整次排入失败，原清单、预览与待排区均保持不变
      setBanner({
        type: "error",
        lines: [`整次排入被拒绝，${staged.length} 台灯均未写入，原清单与预览不变：`, ...errors],
      });
      return;
    }
    const incoming: Assignment[] = staged.map((d) => ({
      uid: d.key,
      fixtureId: d.fixtureId,
      circuitId: d.circuitId,
      channel: Number(d.channel),
      watts: Number(d.watts),
      gel: d.gel.trim(),
      focus: d.focus.trim(),
    }));
    setSessions((list) =>
      list.map((s) => (s.id === selected.id ? { ...s, rows: [...s.rows, ...incoming] } : s))
    );
    setStaged([]);
    setDraft(emptyDraft());
    setBanner({
      type: "success",
      lines: [`已向场次「${selected.name}」整批排入 ${incoming.length} 台灯，全部校验通过。`],
    });
  }

  function removeRow(uidToRemove: string) {
    if (selected.locked) return;
    setSessions((list) =>
      list.map((s) =>
        s.id === selected.id ? { ...s, rows: s.rows.filter((r) => r.uid !== uidToRemove) } : s
      )
    );
    setBanner(null);
  }

  function toggleLock() {
    if (!selected.locked) {
      const errors = lockErrors(selected, sessions);
      if (errors.length > 0) {
        setBanner({ type: "error", lines: errors });
        return;
      }
    }
    const willLock = !selected.locked;
    setSessions((list) =>
      list.map((s) => (s.id === selected.id ? { ...s, locked: willLock } : s))
    );
    setBanner(
      willLock
        ? { type: "success", lines: [`场次「${selected.name}」已锁定，其通道开始占用。`] }
        : { type: "success", lines: [`已解除「${selected.name}」锁定，通道恢复可用，统计已同步。`] }
    );
  }

  function addSession() {
    const name = newName.trim() || `场次 ${sessions.length + 1}`;
    const s: ShowSession = { id: uid(), name, locked: false, rows: [] };
    setSessions((list) => [...list, s]);
    setSelectedId(s.id);
    setStaged([]);
    setDraft(emptyDraft());
    setNewName("");
    setBanner(null);
  }

  function deleteSession(id: string) {
    const target = sessions.find((s) => s.id === id);
    if (!target || target.locked) return;
    const rest = sessions.filter((s) => s.id !== id);
    setSessions(rest);
    if (selectedId === id) setSelectedId(rest[0]?.id ?? null);
    setBanner(null);
  }

  function resetAll() {
    if (!window.confirm("确定恢复为预置回路、灯具与示例场次？本地已保存内容将被清空。")) return;
    const fresh = seedSessions();
    setSessions(fresh);
    setSelectedId(fresh[0].id);
    setStaged([]);
    setDraft(emptyDraft());
    setBanner({ type: "success", lines: ["已恢复预置数据。"] });
  }

  const topPercent = Math.round(topLoad.percent * 100);

  return (
    <main className="app">
      <section className="hero">
        <p>单灯回路载荷复核台 · 演出灯光接线登记</p>
        <h1>单灯回路载荷复核台</h1>
        <span>
          预置 4 个额定回路与 6 台灯具，按演出场次登记灯具编号、通道、功率、色片和焦点。整批排入时逐回路复核总功率、逐通道核对锁定场次占用；
          任一违规，整次排入失败，原清单与预览保持不变。锁定场次即占用通道，解除锁定后立即恢复可用，统计实时同步；数据保存在浏览器本地。
        </span>
      </section>

      <section className="metrics">
        <article>
          <small>当前场次灯具</small>
          <strong>{selected.rows.length}</strong>
          <em>台 · {selected.name}</em>
        </article>
        <article>
          <small>当前场次总功率</small>
          <strong>{totalWatts}</strong>
          <em>W</em>
        </article>
        <article>
          <small>最高回路负载</small>
          <strong className={topPercent >= 100 ? "danger" : topPercent >= 80 ? "warn" : ""}>
            {topPercent}%
          </strong>
          <em>
            {topLoad.circuit.name} · {usage.get(topLoad.circuit.id) ?? 0}/{topLoad.circuit.rated}W
          </em>
        </article>
        <article>
          <small>锁定场次 / 占用通道</small>
          <strong>
            {lockedSessions.length} / {lockedChannels.length}
          </strong>
          <em>场 · 个通道</em>
        </article>
      </section>

      <section className="circuit-grid">
        {CIRCUITS.map((c) => {
          const used = usage.get(c.id) ?? 0;
          const percent = Math.round((used / c.rated) * 100);
          const state = percent > 100 ? "over" : percent === 100 ? "full" : percent >= 80 ? "near" : "ok";
          return (
            <article key={c.id} className={`circuit-card state-${state}`}>
              <div className="circuit-head">
                <div>
                  <h3>{c.name}</h3>
                  <p>{c.note}</p>
                </div>
                <span className="badge">{state === "over" ? "超限" : state === "full" ? "满载" : state === "near" ? "接近满载" : "正常"}</span>
              </div>
              <div className="load-bar">
                <i style={{ width: `${Math.min(percent, 100)}%` }} />
              </div>
              <p className="load-num">
                <strong>{used}</strong> / {c.rated}W · {percent}%
              </p>
            </article>
          );
        })}
      </section>

      <section className="workspace">
        <aside className="panel">
          <div className="heading">
            <div>
              <p>演出场次</p>
              <h2>场次列表</h2>
            </div>
          </div>
          <div className="session-list">
            {sessions.map((s) => (
              <div
                key={s.id}
                className={`session-item ${s.id === selected.id ? "active" : ""} ${s.locked ? "locked" : ""}`}
              >
                <button className="session-select" onClick={() => { setSelectedId(s.id); setBanner(null); }}>
                  <span className="session-name">
                    {s.locked ? "🔒 " : "🔓 "}
                    {s.name}
                  </span>
                  <span className="session-meta">{s.rows.length} 灯 · {s.rows.reduce((x, r) => x + r.watts, 0)}W</span>
                </button>
                {!s.locked && sessions.length > 1 && (
                  <button className="session-del" title="删除该未锁定场次" onClick={() => deleteSession(s.id)}>
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="add-session">
            <input
              value={newName}
              placeholder="新场次名称，如：周末加演"
              onChange={(e) => setNewName(e.target.value)}
            />
            <button className="primary" onClick={addSession}>新建场次</button>
          </div>

          <div className="locked-channels">
            <h3>锁定场次通道占用</h3>
            {lockedChannels.length === 0 ? (
              <p className="muted">暂无锁定场次，全部通道可用。</p>
            ) : (
              <div className="chips">
                {lockedChannels.map(([ch, name]) => (
                  <span key={ch} className="chip" title={`被「${name}」占用`}>
                    CH{fmtCh(ch)} · {name}
                  </span>
                ))}
              </div>
            )}
          </div>

          <button className="reset-btn" onClick={resetAll}>恢复预置数据</button>
        </aside>

        <section className="panel form-panel">
          <div className="heading">
            <div>
              <p>灯具登记 · {selected.name}{selected.locked ? "（已锁定）" : ""}</p>
              <h2>排入灯具到当前场次</h2>
            </div>
            <button className={selected.locked ? "lock-btn is-locked" : "lock-btn"} onClick={toggleLock}>
              {selected.locked ? "🔓 解除锁定" : "🔒 锁定场次"}
            </button>
          </div>

          {selected.locked && (
            <div className="banner warn-banner">
              本场次已锁定：其通道对其他场次标记为占用，清单不可增删。解除锁定后通道恢复可用，统计同步更新。
            </div>
          )}

          {banner && (
            <div className={`banner ${banner.type === "error" ? "error-banner" : "success-banner"}`}>
              {banner.lines.map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
          )}

          <div className="field-grid">
            <label>
              <span>灯具编号（预置六台）</span>
              <select
                value={draft.fixtureId}
                disabled={selected.locked}
                onChange={(e) => pickFixture(e.target.value)}
              >
                {FIXTURES.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.id} · {f.name}（{f.watts}W）
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>接入回路</span>
              <select
                value={draft.circuitId}
                disabled={selected.locked}
                onChange={(e) => setDraft({ ...draft, circuitId: e.target.value })}
              >
                {CIRCUITS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id} · {c.name}（额定 {c.rated}W）
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>通道号（DMX 1–512）</span>
              <input
                type="number"
                min={1}
                max={512}
                placeholder="如 21"
                value={draft.channel}
                disabled={selected.locked}
                onChange={(e) => setDraft({ ...draft, channel: e.target.value })}
              />
            </label>
            <label>
              <span>功率（W）</span>
              <input
                type="number"
                min={1}
                placeholder="如 750"
                value={draft.watts}
                disabled={selected.locked}
                onChange={(e) => setDraft({ ...draft, watts: e.target.value })}
              />
            </label>
            <label>
              <span>色片</span>
              <input
                placeholder="如 L201 中蓝"
                value={draft.gel}
                disabled={selected.locked}
                onChange={(e) => setDraft({ ...draft, gel: e.target.value })}
              />
            </label>
            <label>
              <span>焦点</span>
              <input
                placeholder="如 台口正中"
                value={draft.focus}
                disabled={selected.locked}
                onChange={(e) => setDraft({ ...draft, focus: e.target.value })}
              />
            </label>
          </div>

          <div className="form-actions">
            <button onClick={addToStaged} disabled={selected.locked}>添入待排区</button>
            <button className="primary" onClick={commit} disabled={selected.locked || staged.length === 0}>
              整批排入（{staged.length} 台）并复核
            </button>
          </div>

          <div className="staged">
            <h3>待排区（一次性整批提交）</h3>
            {staged.length === 0 ? (
              <p className="muted">尚无待排灯具。先在上方填写并「添入待排区」，可攒齐多台灯后一次排入。</p>
            ) : (
              <table className="desk-table">
                <thead>
                  <tr>
                    <th>灯具编号</th><th>回路</th><th>通道</th><th>功率</th><th>色片</th><th>焦点</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {staged.map((d) => (
                    <tr key={d.key}>
                      <td>{d.fixtureId}</td>
                      <td>{CIRCUIT_MAP.get(d.circuitId)?.name}</td>
                      <td>CH{fmtCh(Number(d.channel))}</td>
                      <td>{d.watts}W</td>
                      <td>{d.gel}</td>
                      <td>{d.focus}</td>
                      <td>
                        <button className="row-del" disabled={selected.locked} onClick={() => setStaged((l) => l.filter((x) => x.key !== d.key))}>
                          撤出
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>场次清单预览 · {selected.name}</p>
            <h2>已排入灯具（{selected.rows.length}）</h2>
          </div>
          <span className={`save-state ${selected.locked ? "is-locked" : ""}`}>
            {selected.locked ? "🔒 已锁定 · 只读" : "🔓 未锁定 · 可编辑"} · 已自动保存到浏览器本地
          </span>
        </div>
        {selected.rows.length === 0 ? (
          <p className="muted">该场次尚未排入任何灯具。</p>
        ) : (
          <table className="desk-table preview-table">
            <thead>
              <tr>
                <th>灯具编号</th><th>灯具</th><th>回路</th><th>通道</th><th>功率</th><th>色片</th><th>焦点</th><th></th>
              </tr>
            </thead>
            <tbody>
              {selected.rows.map((r) => (
                <tr key={r.uid}>
                  <td><b>{r.fixtureId}</b></td>
                  <td>{FIXTURE_MAP.get(r.fixtureId)?.name ?? "—"}</td>
                  <td>{CIRCUIT_MAP.get(r.circuitId)?.name ?? r.circuitId}</td>
                  <td>CH{fmtCh(r.channel)}</td>
                  <td>{r.watts}W</td>
                  <td>{r.gel}</td>
                  <td>{r.focus}</td>
                  <td>
                    <button className="row-del" disabled={selected.locked} onClick={() => removeRow(r.uid)}>
                      撤下
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

export default App;
