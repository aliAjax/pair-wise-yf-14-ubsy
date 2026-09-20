import { useMemo, useState } from "react";
import "./styles.css";
import type { DraftEntry, SessionEntry, ShowSession } from "./types";
import { nextSessionId, PRESET_CIRCUITS, PRESET_FIXTURES } from "./data";
import {
  circuitLoad,
  commitDraft,
  describeEntry,
  previewDraft,
  type LoadSummary,
} from "./validation";
import { defaultState, usePersistentState } from "./storage";

type Feedback = { kind: "success" | "error"; text: string; details?: string[] } | null;

let draftSeq = 0;
function nextTempId(): string {
  draftSeq += 1;
  return `d-${Date.now().toString(36)}-${draftSeq}`;
}

/* ---------- 小组件 ---------- */

function LoadBar({ load }: { load: LoadSummary }) {
  const tone = load.overload ? "bad" : load.percent >= 85 ? "warn" : "ok";
  return (
    <div className={`loadbar ${tone}`}>
      <div className="loadbar-track">
        <div className="loadbar-fill" style={{ width: `${Math.min(load.percent, 100)}%` }} />
      </div>
      <span className={`loadbar-text ${tone}`}>
        {load.used}/{load.rating}W · {load.percent}%{load.overload ? " · 超载" : ""}
      </span>
    </div>
  );
}

function LockBadge({ locked }: { locked: boolean }) {
  return <span className={`badge ${locked ? "locked" : "open"}`}>{locked ? "🔒 已锁定" : "未锁定"}</span>;
}

/* ---------- 主应用 ---------- */

function App() {
  const { state, setState, savedAt } = usePersistentState();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [newSessionName, setNewSessionName] = useState("");

  const { sessions, drafts, activeSessionId } = state;
  const session = sessions.find((s) => s.id === activeSessionId) ?? sessions[0];
  const draft = drafts[session.id] ?? [];

  const fixtureMap = useMemo(
    () => new Map(PRESET_FIXTURES.map((f) => [f.id, f])),
    [],
  );
  const circuitMap = useMemo(
    () => new Map(PRESET_CIRCUITS.map((c) => [c.id, c])),
    [],
  );

  const draftIssues = useMemo(
    () => previewDraft(draft, session, sessions, PRESET_CIRCUITS),
    [draft, session, sessions],
  );
  const issueMap = useMemo(
    () => new Map(draftIssues.map((i) => [i.tempId, i.messages])),
    [draftIssues],
  );

  /* ---------- 顶部统计 ---------- */
  const totalEntries = sessions.reduce((n, s) => n + s.entries.length, 0);
  const lockedCount = sessions.filter((s) => s.locked).length;

  const peakByCircuit = PRESET_CIRCUITS.map((c) => {
    let peak = 0;
    let peakSession = "";
    sessions.forEach((s) => {
      const used = s.entries.filter((e) => e.circuitId === c.id).reduce((sum, e) => sum + e.power, 0);
      if (used > peak) {
        peak = used;
        peakSession = s.name;
      }
    });
    return { circuit: c, peak, peakSession, overload: peak > c.rating };
  });
  const overloadCircuitCount = peakByCircuit.filter((p) => p.overload).length;

  const lockedChannels = useMemo(() => {
    const set = new Set<number>();
    sessions.filter((s) => s.locked).forEach((s) => s.entries.forEach((e) => set.add(e.channel)));
    return Array.from(set).sort((a, b) => a - b);
  }, [sessions]);

  /* ---------- 草稿（候排预览）操作 ---------- */

  function updateDraft(mutator: (list: DraftEntry[]) => DraftEntry[]) {
    setState((prev) => ({
      ...prev,
      drafts: { ...prev.drafts, [session.id]: mutator(prev.drafts[session.id] ?? []) },
    }));
  }

  function addFixtureToDraft(fixtureId: string) {
    if (session.locked) {
      setFeedback({ kind: "error", text: `场次「${session.name}」已锁定，不能排入灯具` });
      return;
    }
    const f = fixtureMap.get(fixtureId);
    if (!f) return;
    // 建议一个未占用的回路
    const suggested = PRESET_CIRCUITS[0].id;
    updateDraft((list) => [
      ...list,
      {
        tempId: nextTempId(),
        fixtureId: f.id,
        circuitId: suggested,
        channel: f.channel,
        power: f.power,
        gel: f.gel,
        focus: f.focus,
      },
    ]);
    setFeedback(null);
  }

  function patchDraftRow(tempId: string, patch: Partial<DraftEntry>) {
    updateDraft((list) => list.map((d) => (d.tempId === tempId ? { ...d, ...patch } : d)));
  }

  function removeDraftRow(tempId: string) {
    updateDraft((list) => list.filter((d) => d.tempId !== tempId));
  }

  function applyFixturePreset(tempId: string, fixtureId: string) {
    const f = fixtureMap.get(fixtureId);
    if (!f) return;
    patchDraftRow(tempId, { fixtureId: f.id, channel: f.channel, power: f.power, gel: f.gel, focus: f.focus });
  }

  function handleCommit() {
    const result = commitDraft(draft, session, sessions, PRESET_CIRCUITS);
    if (!result.ok) {
      // 整次排入失败：原清单与候排预览均保持不变
      setFeedback({
        kind: "error",
        text: `复核未通过，整次排入已取消（${result.errors.length} 项违规），已排入清单未改动`,
        details: result.errors,
      });
      return;
    }
    setState((prev) => ({
      ...prev,
      sessions: prev.sessions.map((s) =>
        s.id === session.id ? { ...s, entries: [...s.entries, ...result.entries] } : s,
      ),
      drafts: { ...prev.drafts, [session.id]: [] },
    }));
    setFeedback({
      kind: "success",
      text: `复核通过，已向「${session.name}」排入 ${result.entries.length} 台灯`,
    });
  }

  /* ---------- 已排入清单 / 场次操作 ---------- */

  function removeEntry(uid: string) {
    if (session.locked) {
      setFeedback({ kind: "error", text: "已锁定场次的清单不可改动" });
      return;
    }
    setState((prev) => ({
      ...prev,
      sessions: prev.sessions.map((s) =>
        s.id === session.id ? { ...s, entries: s.entries.filter((e) => e.uid !== uid) } : s,
      ),
    }));
    setFeedback({ kind: "success", text: "已从清单移除，回路载荷与统计已同步" });
  }

  function toggleLock() {
    setState((prev) => ({
      ...prev,
      sessions: prev.sessions.map((s) =>
        s.id === session.id ? { ...s, locked: !s.locked } : s,
      ),
    }));
    setFeedback(
      session.locked
        ? { kind: "success", text: `已解除「${session.name}」锁定，其通道恢复可用` }
        : { kind: "success", text: `「${session.name}」已锁定，其通道对其他场次占位` },
    );
  }

  function switchSession(id: string) {
    setState((prev) => ({ ...prev, activeSessionId: id }));
    setFeedback(null);
  }

  function addSession() {
    const name = newSessionName.trim();
    if (!name) {
      setFeedback({ kind: "error", text: "请填写新场次名称" });
      return;
    }
    const id = nextSessionId();
    setState((prev) => ({
      ...prev,
      sessions: [...prev.sessions, { id, name, locked: false, entries: [] }],
      activeSessionId: id,
    }));
    setNewSessionName("");
    setFeedback(null);
  }

  function deleteSession(id: string) {
    const target = sessions.find((s) => s.id === id);
    if (!target) return;
    if (target.locked) {
      setFeedback({ kind: "error", text: "请先解除锁定再删除场次" });
      return;
    }
    if (target.entries.length > 0) {
      setFeedback({ kind: "error", text: `「${target.name}」清单非空，请先清空灯次` });
      return;
    }
    if (!window.confirm(`确定删除空场次「${target.name}」？`)) return;
    setState((prev) => {
      const rest = prev.sessions.filter((s) => s.id !== id);
      const draftsRest = { ...prev.drafts };
      delete draftsRest[id];
      return {
        ...prev,
        sessions: rest,
        drafts: draftsRest,
        activeSessionId: prev.activeSessionId === id ? rest[0].id : prev.activeSessionId,
      };
    });
    setFeedback(null);
  }

  function resetAll() {
    if (!window.confirm("确定恢复出厂预置（四路 / 六灯 / 三个示例场次）并清空本地保存？")) return;
    setState(defaultState());
    setFeedback(null);
  }

  /* ---------- 渲染 ---------- */

  return (
    <main className="app">
      <header className="hero">
        <div className="hero-row">
          <div>
            <p className="kicker">单灯回路载荷复核台 · LOAD BENCH</p>
            <h1>剧场灯光回路载荷复核</h1>
            <span>按演出场次逐台登记灯具编号、通道、功率、色片与焦点；整次排入统一复核回路额定负载与锁定场次通道冲突，任一违规即全部退回。</span>
          </div>
          <div className="save-box">
            <span className="save-dot" />
            {savedAt ? `已保存到本地 ${new Date(savedAt).toLocaleTimeString("zh-CN")}` : "自动保存中"}
            <button className="ghost" onClick={resetAll} title="恢复预置数据">恢复预置</button>
          </div>
        </div>
        <ul className="rule-strip">
          <li>① 同回路总功率 ≤ 额定负载</li>
          <li>② 通道不得与已锁定场次重复</li>
          <li>③ 任一违规，整次排入失败、原清单不变</li>
          <li>④ 解锁后通道释放，统计同步</li>
        </ul>
      </header>

      {/* 顶部统计 */}
      <section className="metrics">
        <article>
          <small>已登记灯次（全场次）</small>
          <strong>{totalEntries}</strong>
        </article>
        <article>
          <small>已锁定场次</small>
          <strong>{lockedCount}<em> / {sessions.length}</em></strong>
        </article>
        <article>
          <small>回路峰值超载</small>
          <strong className={overloadCircuitCount > 0 ? "num-bad" : "num-ok"}>{overloadCircuitCount}</strong>
        </article>
        <article>
          <small>锁定通道占用</small>
          <strong>{lockedChannels.length}<em> 个通道</em></strong>
        </article>
      </section>

      {/* 四路回路状态 */}
      <section className="panel">
        <div className="heading">
          <div>
            <p className="kicker">四路回路</p>
            <h2>额定负载与全场次峰值</h2>
          </div>
          <span className="muted">峰值取该回路在各场次（含未锁定）中的最高用量</span>
        </div>
        <div className="circuit-grid">
          {peakByCircuit.map(({ circuit, peak, peakSession, overload }) => {
            const current = circuitLoad(session.entries, circuit);
            return (
              <article key={circuit.id} className={`circuit-card ${overload ? "is-over" : ""}`}>
                <header>
                  <b>{circuit.id}</b>
                  <h3>{circuit.name}</h3>
                  <span>额定 {circuit.rating}W</span>
                </header>
                <div className="circuit-rows">
                  <div>
                    <label>本场「{session.name}」</label>
                    <LoadBar load={current} />
                  </div>
                  <div>
                    <label>全场次峰值 · {peakSession || "—"}</label>
                    <LoadBar load={{ used: peak, rating: circuit.rating, percent: Math.round((peak / circuit.rating) * 100), overload }} />
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <div className="workspace">
        {/* 左：灯具台账 */}
        <aside className="panel library-panel">
          <div className="heading">
            <div>
              <p className="kicker">六台灯具 · 预置台账</p>
              <h2>灯具库</h2>
            </div>
          </div>
          <div className="fixture-list">
            {PRESET_FIXTURES.map((f) => {
              const usedHere = session.entries.some((e) => e.fixtureId === f.id);
              return (
                <article key={f.id} className={`fixture-card ${usedHere ? "used" : ""}`}>
                  <header>
                    <b>{f.id}</b>
                    {usedHere && <span className="tag">本场已排</span>}
                  </header>
                  <h3>{f.name}</h3>
                  <p className="model">{f.model}</p>
                  <dl>
                    <div><dt>通道</dt><dd>CH {f.channel}</dd></div>
                    <div><dt>功率</dt><dd>{f.power}W</dd></div>
                    <div><dt>色片</dt><dd>{f.gel}</dd></div>
                    <div><dt>焦点</dt><dd>{f.focus}</dd></div>
                  </dl>
                  <button className="primary full" disabled={session.locked} onClick={() => addFixtureToDraft(f.id)}>
                    {session.locked ? "场次已锁定" : "加入候排"}
                  </button>
                </article>
              );
            })}
          </div>
        </aside>

        {/* 右：场次工作区 */}
        <section className="panel session-panel">
          <div className="session-tabs" role="tablist">
            {sessions.map((s) => (
              <button
                key={s.id}
                role="tab"
                aria-selected={s.id === session.id}
                className={`session-tab ${s.id === session.id ? "active" : ""}`}
                onClick={() => switchSession(s.id)}
              >
                <span>{s.name}</span>
                <small>{s.entries.length} 灯 · {s.locked ? "锁定" : "开放"}</small>
              </button>
            ))}
          </div>

          <div className="session-head">
            <div>
              <h2>{session.name} <LockBadge locked={session.locked} /></h2>
              <p className="muted">
                已排入 {session.entries.length} 台灯 ·
                通道 {session.entries.map((e) => e.channel).sort((a, b) => a - b).map((c) => `CH${c}`).join("、") || "无"}
              </p>
            </div>
            <div className="actions">
              <button className={session.locked ? "primary" : "lock-btn"} onClick={toggleLock}>
                {session.locked ? "🔓 解除锁定（恢复通道可用）" : "🔒 锁定本场（通道占位）"}
              </button>
              <button className="ghost danger" onClick={() => deleteSession(session.id)} disabled={session.locked}>
                删除场次
              </button>
            </div>
          </div>

          {feedback && (
            <div className={`feedback ${feedback.kind}`}>
              <strong>{feedback.kind === "error" ? "⛔ " : "✅ "}{feedback.text}</strong>
              {feedback.details && feedback.details.length > 0 && (
                <ul>{feedback.details.map((d, i) => <li key={i}>{d}</li>)}</ul>
              )}
            </div>
          )}

          {/* 已排入清单 */}
          <div className="table-wrap">
            <table className="roster-table">
              <thead>
                <tr>
                  <th>灯具编号</th><th>回路</th><th>通道</th><th>功率</th><th>色片</th><th>焦点</th><th>状态</th><th></th>
                </tr>
              </thead>
              <tbody>
                {session.entries.length === 0 && (
                  <tr className="empty-row"><td colSpan={8}>本场尚未排入灯具，从左侧灯具库「加入候排」开始登记</td></tr>
                )}
                {session.entries.map((entry: SessionEntry) => {
                  const f = fixtureMap.get(entry.fixtureId);
                  const c = circuitMap.get(entry.circuitId);
                  const conflict = describeEntry(entry, session, sessions, PRESET_CIRCUITS);
                  const over = conflict.loadAfter?.overload ?? false;
                  return (
                    <tr key={entry.uid} className={over || conflict.channelHolders.length > 0 ? "row-bad" : ""}>
                      <td><b>{entry.fixtureId}</b><small>{f?.name ?? "未知灯具"}</small></td>
                      <td>{entry.circuitId}<small>{c?.name ?? ""}</small></td>
                      <td>CH {entry.channel}</td>
                      <td>{entry.power}W</td>
                      <td>{entry.gel}</td>
                      <td>{entry.focus}</td>
                      <td>
                        {over && <span className="chip bad">回路超载</span>}
                        {conflict.channelHolders.length > 0 && (
                          <span className="chip bad">通道被「{conflict.channelHolders.join("、")}」锁定</span>
                        )}
                        {!over && conflict.channelHolders.length === 0 && <span className="chip ok">正常</span>}
                      </td>
                      <td>
                        <button className="ghost mini" disabled={session.locked} onClick={() => removeEntry(entry.uid)}>移除</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 候排预览 / 登记 */}
          <div className="draft-zone">
            <div className="heading">
              <div>
                <p className="kicker">候排预览</p>
                <h2>本场灯具登记（{draft.length} 台灯待复核）</h2>
              </div>
              <div className="actions">
                <button className="ghost" disabled={draft.length === 0 || session.locked} onClick={() => updateDraft(() => [])}>清空预览</button>
                <button className="primary" disabled={draft.length === 0 || session.locked} onClick={handleCommit}>
                  ✓ 整批排入（统一复核）
                </button>
              </div>
            </div>
            {session.locked && <p className="locked-note">本场已锁定：清单只读，且不能新增候排。解除锁定后恢复。</p>}
            <div className="table-wrap">
              <table className="draft-table">
                <thead>
                  <tr>
                    <th>灯具编号</th><th>回路</th><th>通道</th><th>功率(W)</th><th>色片</th><th>焦点</th><th>预校验</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {draft.length === 0 && (
                    <tr className="empty-row"><td colSpan={8}>候排为空——点击左侧灯具卡片的「加入候排」，在此逐台调整后一次排入</td></tr>
                  )}
                  {draft.map((d) => {
                    const issues = issueMap.get(d.tempId) ?? [];
                    return (
                      <tr key={d.tempId} className={issues.length > 0 ? "row-warn" : ""}>
                        <td>
                          <select value={d.fixtureId} onChange={(e) => applyFixturePreset(d.tempId, e.target.value)}>
                            {PRESET_FIXTURES.map((f) => <option key={f.id} value={f.id}>{f.id} · {f.name}</option>)}
                          </select>
                        </td>
                        <td>
                          <select value={d.circuitId} onChange={(e) => patchDraftRow(d.tempId, { circuitId: e.target.value })}>
                            {PRESET_CIRCUITS.map((c) => <option key={c.id} value={c.id}>{c.id} · {c.name}（{c.rating}W）</option>)}
                          </select>
                        </td>
                        <td><input className="narrow" type="number" min={1} max={512} value={d.channel} onChange={(e) => patchDraftRow(d.tempId, { channel: e.target.value === "" ? "" : Number(e.target.value) })} /></td>
                        <td><input className="narrow" type="number" min={1} value={d.power} onChange={(e) => patchDraftRow(d.tempId, { power: e.target.value === "" ? "" : Number(e.target.value) })} /></td>
                        <td><input value={d.gel} onChange={(e) => patchDraftRow(d.tempId, { gel: e.target.value })} /></td>
                        <td><input value={d.focus} onChange={(e) => patchDraftRow(d.tempId, { focus: e.target.value })} /></td>
                        <td>
                          {issues.length === 0
                            ? <span className="chip ok">可排入</span>
                            : <ul className="issue-list">{issues.map((m, i) => <li key={i}>{m}</li>)}</ul>}
                        </td>
                        <td><button className="ghost mini" onClick={() => removeDraftRow(d.tempId)}>删</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* 新增场次 */}
          <div className="add-session">
            <input value={newSessionName} placeholder="新增演出场次名称，如：周六午场" onChange={(e) => setNewSessionName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addSession()} />
            <button className="primary" onClick={addSession}>＋ 新增场次</button>
          </div>
        </section>
      </div>

      <footer className="foot-note">
        数据仅保存在本浏览器 localStorage（key: load-bench:v1），刷新与重开页面均保留；四路回路与六台灯具为预置台账。
      </footer>
    </main>
  );
}

export default App;
