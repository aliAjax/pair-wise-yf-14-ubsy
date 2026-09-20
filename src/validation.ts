import type { Circuit, DraftEntry, SessionEntry, ShowSession } from "./types";
import { nextUid } from "./data";

export interface LoadSummary {
  used: number;
  rating: number;
  percent: number;
  overload: boolean;
}

/** 计算某回路在一批已排入记录中的载荷 */
export function circuitLoad(entries: Pick<SessionEntry, "circuitId" | "power">[], circuit: Circuit): LoadSummary {
  const used = entries
    .filter((e) => e.circuitId === circuit.id)
    .reduce((sum, e) => sum + (Number.isFinite(e.power) ? e.power : 0), 0);
  return {
    used,
    rating: circuit.rating,
    percent: circuit.rating > 0 ? Math.round((used / circuit.rating) * 100) : 0,
    overload: used > circuit.rating,
  };
}

/** 跨场次：返回已锁定且占用指定通道的场次名（不含当前场次） */
export function findLockedChannelHolders(
  sessions: ShowSession[],
  channel: number,
  currentSessionId: string,
): string[] {
  return sessions
    .filter((s) => s.locked && s.id !== currentSessionId)
    .filter((s) => s.entries.some((e) => e.channel === channel))
    .map((s) => s.name);
}

/** 单条已排入记录的冲突状态（用于清单徽标） */
export interface EntryConflict {
  channelHolders: string[];
  loadAfter: LoadSummary | null;
}

export function describeEntry(
  entry: SessionEntry,
  session: ShowSession,
  sessions: ShowSession[],
  circuits: Circuit[],
): EntryConflict {
  const circuit = circuits.find((c) => c.id === entry.circuitId) ?? null;
  const loadAfter = circuit ? circuitLoad(session.entries, circuit) : null;
  const channelHolders = findLockedChannelHolders(sessions, entry.channel, session.id);
  return { channelHolders, loadAfter };
}

/** 候排草稿行的预校验（不改数据，仅给预览提示） */
export interface DraftIssue {
  tempId: string;
  messages: string[];
}

export function previewDraft(
  draft: DraftEntry[],
  session: ShowSession,
  sessions: ShowSession[],
  circuits: Circuit[],
): DraftIssue[] {
  return draft.map((d) => {
    const messages: string[] = [];
    const channel = typeof d.channel === "number" ? d.channel : NaN;
    const power = typeof d.power === "number" ? d.power : NaN;

    if (!Number.isInteger(channel) || channel < 1 || channel > 512) {
      messages.push("通道须为 1–512 的整数");
    }
    if (!Number.isFinite(power) || power <= 0) {
      messages.push("功率须大于 0");
    }

    const circuit = circuits.find((c) => c.id === d.circuitId);
    if (circuit && Number.isFinite(power) && power > 0) {
      const existing = session.entries
        .filter((e) => e.circuitId === circuit.id)
        .reduce((sum, e) => sum + e.power, 0);
      // 同批次内排在本行之前、同回路的草稿功率
      const batchBefore = draft
        .filter((x) => x !== d && x.circuitId === circuit.id && typeof x.power === "number" && x.power > 0)
        .reduce((sum, x) => sum + (x.power as number), 0);
      if (existing + batchBefore + power > circuit.rating) {
        messages.push(`并入后 ${circuit.name} 将达 ${existing + batchBefore + power}W / ${circuit.rating}W`);
      }
    }

    if (Number.isInteger(channel)) {
      if (session.entries.some((e) => e.channel === channel)) {
        messages.push(`通道 ${channel} 已在本场清单内`);
      }
      const holders = findLockedChannelHolders(sessions, channel, session.id);
      if (holders.length > 0) {
        messages.push(`通道 ${channel} 被锁定场次「${holders.join("、")}」占用`);
      }
    }

    return { tempId: d.tempId, messages };
  });
}

/**
 * 整次排入复核：任意一条违规即整体失败，不产生任何写入。
 * 成功时返回可并入清单的正式记录。
 */
export interface CommitResult {
  ok: boolean;
  errors: string[];
  entries: SessionEntry[];
}

export function commitDraft(
  draft: DraftEntry[],
  session: ShowSession,
  sessions: ShowSession[],
  circuits: Circuit[],
): CommitResult {
  const errors: string[] = [];

  if (session.locked) {
    return { ok: false, errors: [`场次「${session.name}」已锁定，无法排入`], entries: [] };
  }
  if (draft.length === 0) {
    return { ok: false, errors: ["候排清单为空"], entries: [] };
  }

  // 1. 逐条基础校验 + 与已锁定场次的通道冲突
  draft.forEach((d, index) => {
    const tag = `第 ${index + 1} 行（${d.fixtureId}）`;
    const channel = typeof d.channel === "number" ? d.channel : NaN;
    const power = typeof d.power === "number" ? d.power : NaN;

    if (!d.circuitId) errors.push(`${tag}：未选择回路`);
    if (!d.fixtureId) errors.push(`${tag}：未选择灯具`);
    if (!Number.isInteger(channel) || channel < 1 || channel > 512) {
      errors.push(`${tag}：通道须为 1–512 的整数`);
    }
    if (!Number.isFinite(power) || power <= 0) {
      errors.push(`${tag}：功率须为大于 0 的数字`);
    }
    if (!d.gel.trim()) errors.push(`${tag}：色片未登记`);
    if (!d.focus.trim()) errors.push(`${tag}：焦点未登记`);

    if (Number.isInteger(channel)) {
      if (session.entries.some((e) => e.channel === channel)) {
        errors.push(`${tag}：通道 ${channel} 已在本场清单内`);
      }
      const holders = findLockedChannelHolders(sessions, channel, session.id);
      if (holders.length > 0) {
        errors.push(`${tag}：通道 ${channel} 与锁定场次「${holders.join("、")}」冲突`);
      }
    }
  });

  // 2. 本批次内部：灯具不得重复登记，通道不得重复
  const fixtureSeen = new Map<string, number>();
  const channelSeen = new Map<number, number>();
  draft.forEach((d, index) => {
    if (d.fixtureId) {
      const first = fixtureSeen.get(d.fixtureId);
      if (first === undefined) fixtureSeen.set(d.fixtureId, index + 1);
      else errors.push(`第 ${index + 1} 行：灯具 ${d.fixtureId} 与第 ${first} 行重复登记`);
    }
    if (typeof d.channel === "number" && Number.isInteger(d.channel)) {
      const first = channelSeen.get(d.channel);
      if (first === undefined) channelSeen.set(d.channel, index + 1);
      else errors.push(`第 ${index + 1} 行：通道 ${d.channel} 与第 ${first} 行重复`);
    }
  });

  // 3. 整次功率复核：并入后任一回路不得超过额定负载
  circuits.forEach((circuit) => {
    const existing = session.entries
      .filter((e) => e.circuitId === circuit.id)
      .reduce((sum, e) => sum + e.power, 0);
    const adding = draft
      .filter((d) => d.circuitId === circuit.id && typeof d.power === "number" && d.power > 0)
      .reduce((sum, d) => sum + (d.power as number), 0);
    if (existing + adding > circuit.rating) {
      errors.push(
        `${circuit.name}（${circuit.id}）并入后总功率 ${existing + adding}W，超过额定 ${circuit.rating}W（已用 ${existing}W，本次 +${adding}W）`,
      );
    }
  });

  if (errors.length > 0) {
    return { ok: false, errors: Array.from(new Set(errors)), entries: [] };
  }

  const entries: SessionEntry[] = draft.map((d) => ({
    uid: nextUid(),
    fixtureId: d.fixtureId,
    circuitId: d.circuitId,
    channel: d.channel as number,
    power: d.power as number,
    gel: d.gel.trim(),
    focus: d.focus.trim(),
  }));
  return { ok: true, errors: [], entries };
}
