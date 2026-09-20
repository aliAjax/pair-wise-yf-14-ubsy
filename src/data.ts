import type { Circuit, Fixture, ShowSession } from "./types";

/** 预置四个回路 */
export const PRESET_CIRCUITS: Circuit[] = [
  { id: "C1", name: "面光主回路", rating: 2400 },
  { id: "C2", name: "侧光流动回路", rating: 2000 },
  { id: "C3", name: "顶光逆光回路", rating: 1800 },
  { id: "C4", name: "效果追光回路", rating: 1200 },
];

/** 预置六台灯具 */
export const PRESET_FIXTURES: Fixture[] = [
  { id: "L-01", name: "面光成像灯 A", model: "Source Four 750", power: 750, channel: 101, gel: "L201 全 CTB", focus: "表演区前左" },
  { id: "L-02", name: "面光成像灯 B", model: "Source Four 750", power: 750, channel: 102, gel: "L201 全 CTB", focus: "表演区前中" },
  { id: "L-03", name: "侧光螺纹聚光", model: "Fresnel 650", power: 650, channel: 201, gel: "R54 淡蓝", focus: "上场门侧光" },
  { id: "L-04", name: "逆光 PAR 灯", model: "PAR64 1000N", power: 1000, channel: 301, gel: "R26 亮红", focus: "后区逆光" },
  { id: "L-05", name: "追光灯", model: "Followspot 1200", power: 1200, channel: 401, gel: "无", focus: "跟焦主角" },
  { id: "L-06", name: "天排泛光灯", model: "Cyclorama 500", power: 500, channel: 501, gel: "L117 深蓝", focus: "天幕下沿" },
];

export function nextUid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `u-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

let sessionSeq = 0;
export function nextSessionId(): string {
  sessionSeq += 1;
  return `S${Date.now().toString(36)}${sessionSeq}`;
}

/** 初始场次：首场已锁定（通道 101/102 对其他锁定场次构成占位） */
export function buildInitialSessions(): ShowSession[] {
  return [
    {
      id: "s-seed-1",
      name: "首场 · 开幕",
      locked: true,
      entries: [
        { uid: nextUid(), fixtureId: "L-01", circuitId: "C1", channel: 101, power: 750, gel: "L201 全 CTB", focus: "表演区前左" },
        { uid: nextUid(), fixtureId: "L-02", circuitId: "C1", channel: 102, power: 750, gel: "L201 全 CTB", focus: "表演区前中" },
        { uid: nextUid(), fixtureId: "L-06", circuitId: "C3", channel: 501, power: 500, gel: "L117 深蓝", focus: "天幕下沿" },
      ],
    },
    {
      id: "s-seed-2",
      name: "次场 · 独白",
      locked: false,
      entries: [
        { uid: nextUid(), fixtureId: "L-05", circuitId: "C4", channel: 401, power: 1200, gel: "无", focus: "跟焦主角" },
      ],
    },
    {
      id: "s-seed-3",
      name: "末场 · 谢幕",
      locked: false,
      entries: [],
    },
  ];
}
