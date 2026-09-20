/** 回路：预置四路，额定负载单位 W */
export interface Circuit {
  id: string;
  name: string;
  rating: number;
}

/** 灯具台账：预置六台 */
export interface Fixture {
  id: string;
  name: string;
  model: string;
  power: number;
  channel: number;
  gel: string;
  focus: string;
}

/** 某场次已排入清单中的一条灯次记录 */
export interface SessionEntry {
  uid: string;
  fixtureId: string;
  circuitId: string;
  channel: number;
  power: number;
  gel: string;
  focus: string;
}

/** 演出场次（可锁定，锁定后通道参与冲突占位） */
export interface ShowSession {
  id: string;
  name: string;
  locked: boolean;
  entries: SessionEntry[];
}

/** 候排预览中的草稿行（尚未通过复核） */
export interface DraftEntry {
  tempId: string;
  fixtureId: string;
  circuitId: string;
  channel: number | "";
  power: number | "";
  gel: string;
  focus: string;
}
