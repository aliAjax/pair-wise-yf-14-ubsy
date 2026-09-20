import "./styles.css";

const project = {
  "sourceNo": 2,
  "id": "hxyfront-62002",
  "port": 62002,
  "title": "剧场灯光Cue表管理",
  "domain": "剧场灯光",
  "prompt": "做一个给剧场灯光师使用的灯位与Cue表管理前端项目，可以维护演出名称、灯具编号、通道号、色片、焦点位置、亮度预设和Cue触发顺序。页面需要有舞台平面灯位图、Cue列表、当前场景预览、灯具筛选和演出版本备注，适合排练期间快速调整。",
  "palette": [
    "#7c3aed",
    "#f59e0b",
    "#06b6d4"
  ],
  "metrics": [
    "灯具数量",
    "Cue数量",
    "当前场景",
    "待确认焦点"
  ],
  "filters": [
    "面光",
    "侧光",
    "逆光",
    "效果光"
  ],
  "fields": [
    "演出名称",
    "灯具编号",
    "通道号",
    "色片",
    "焦点位置",
    "亮度预设"
  ],
  "records": [
    [
      "Cue 12",
      "冷蓝侧光",
      "CH 021-028，亮度65%",
      "二幕开场"
    ],
    [
      "Cue 18",
      "追光入场",
      "FOH-03，焦点门口",
      "需演员走位确认"
    ],
    [
      "Cue 24",
      "暖色谢幕",
      "全台面光80%",
      "版本B"
    ]
  ]
};

function App() {
  return (
    <main className="app">
      <section className="hero">
        <p>{project.id} · 源提示词{project.sourceNo} · Port {project.port}</p>
        <h1>{project.title}</h1>
        <span>{project.prompt}</span>
      </section>

      <section className="metrics">
        {project.metrics.map((metric: string, index: number) => (
          <article key={metric}>
            <small>{metric}</small>
            <strong>{[86, 14, 7, 32][index] ?? 12}</strong>
          </article>
        ))}
      </section>

      <section className="workspace">
        <aside className="panel">
          <h2>{project.domain}筛选</h2>
          <div className="chips">
            {project.filters.map((item: string) => (
              <button key={item}>{item}</button>
            ))}
          </div>
        </aside>

        <section className="panel form-panel">
          <div className="heading">
            <div>
              <p>专业字段</p>
              <h2>新增记录</h2>
            </div>
            <button className="primary">保存草稿</button>
          </div>
          <div className="field-grid">
            {project.fields.map((field: string) => (
              <label key={field}>
                <span>{field}</span>
                <input placeholder={"填写" + field} />
              </label>
            ))}
          </div>
        </section>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>历史记录</p>
            <h2>近期工作台</h2>
          </div>
          <button>导出摘要</button>
        </div>
        <div className="records">
          {project.records.map((record: string[], index: number) => (
            <article key={record.join("-")}>
              <b>{String(index + 1).padStart(2, "0")}</b>
              <div>
                <h3>{record[0]}</h3>
                <p>{record.slice(1).join(" · ")}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

export default App;
