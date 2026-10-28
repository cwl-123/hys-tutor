# hys-tutor 架构 / 技术栈 / 数据设计

> 本文描述本地单用户架构。公网邀请制内测的账号体系、控制面 SQLite、按用户隔离的数据目录、Nginx/systemd 部署与安全加固见 `Launch-Design.md`；两处冲突时以 `Launch-Design.md` 为准。

> 版本 v0.2（2026-09-30），对应 PRD v1.1.0。单人本地工具，一切选型走"最薄可行"；
> 唯一例外是备课环节：升级为 **Agent 主动搜索研究**，而非单次模型问答。

## 1. 总体架构

单体应用：Vite 一个进程同时承载前端与后端（dev middleware），无独立部署。

```
┌─────────────────────────── Browser (Vue 3 SPA) ───────────────────────────┐
│  图谱页(Vue Flow)   课程页(markdown-it+Shiki+KaTeX)   练习页   报错入口    │
│         Pinia store: topic / graph / lesson / attempt                     │
└──────────────┬─────────────────────────────────────────────────────────────┘
               │ REST (JSON) + SSE (流式生成进度)
┌──────────────▼──────────────── Vite Dev Middleware (Node) ─────────────────┐
│  routes/         api 路由层（薄，只做参数校验和编排）                        │
│  services/                                                                  │
│    ├─ graph-service     开课 Agent（联网调研方向→生成 DAG）+ 校验 + 手动编辑   │
│    ├─ graph-chat        图谱 AI 对话调整（修改建议+diff，确认后应用）          │
│    ├─ scheduler         纯函数排课引擎：已解锁(依赖≥80)且分最低              │
│    ├─ lesson-agent      备课 Agent（多轮工具循环，见 §1.1）                  │
│    ├─ lesson-service    课程查询/列表/题目脱敏                               │
│    ├─ grading-service   客观题本地秒判；简答交卷后 LLM 批改                  │
│    ├─ mastery-service   掌握分增减（唯一写入口，记录 MasteryLog）            │
│    └─ report-service    "这里有错"记录，供备课 Agent 注入上下文              │
│  agent/                Agent 运行时：手写工具循环 + 工具注册表               │
│    ├─ tools/web-search  搜索（Tavily/博查 API）                             │
│    ├─ tools/web-fetch   抓取网页正文（readability 提取）                     │
│    └─ tools/notes       研究笔记读写（按知识点缓存复用）                     │
│  llm/                LLM 客户端（OpenAI 兼容，function calling + 流式）      │
│  repo/               JSON 文件读写（原子写：tmp+rename），仓储接口            │
└──────────────┬──────────────────────────────────────────────────────────────┘
               │
        data/*.json（本地文件，git 忽略）        .env（LLM/搜索 API key，git 忽略）
```

### 1.1 备课 Agent（核心变化）

课程不再是一次 prompt 生成，而是「代码编排 + 有界 Agent」，SSE 逐阶段推进度：

```
schedule(规则选题)
   ↓
research-prefetch  代码按 3 个角度并行搜索（原理/实战/误区），每个角度留 3 条候选，
                   剔除 PDF/文档站/付费预览页；搜索结果落盘可复盘。不再让 Agent 自己搜。
   ↓
research   有界 Agent 从候选里挑 2~3 篇抓正文（web_fetch ≤3 次），
           可用 image_search 1 次；最多 6 轮，超预算强制收尾。
           提炼成研究笔记：核心概念 / 公式推导 / 典型例题 / 常见误区 / 来源 URL / 配图
           ※ 笔记按 nodeId 缓存，同知识点二次备课直接复用
           ※ 研究完成后立即串行生成大纲（high 档下并行会抢模型队列，反而更慢）
   ↓
write      按大纲 + 笔记写课程 markdown（2800~3500 字），关键结论标注来源引用 [1][2]，
           流式输出给前端；抽象结构用 ```mermaid（1~3 张），配图用 ![图注](localPath)（0~2 张）
   ↓
draft-saved 正文一写完立刻落盘（status=writing）——后续任何一步失败都不丢正文
   ↓
后处理      sanitizeCitations（剔除越界引用）→ localizeImages（外链图落地，失败剔除）
           → 落最终课件（status=generated）→ 立即向用户交付
   ↓
done        课末题 / 内容质检 / 案例归档转为后台异步，不阻塞出课
```

**异步任务**
- `ensureQuestions(lessonId)`：后台生成 5 道课末题（2 单选 + 2 判断 + 1 简答），
  与用户点「生成课末题」共用同一个 in-flight Promise；题目未就绪时课程页显示「生成中」
- `runQualityPass`：课后对照笔记只找事实性矛盾；只有此类问题才重写一次正文，
  图片 URL/引用越界/排版类问题交给后处理，不再触发全文重写
- `recordTaughtForLesson`：归档本课案例，跑失败不影响课件

**为什么这样设计**
- 搜索解决幻觉：课程事实性内容有网上精华来源背书，且页面展示引用链接，可溯源
- 决策仍在代码里：排课、掌握分、阶段流转是工程逻辑；Agent 的"自主"限定在研究环节（搜什么、读哪篇、提炼什么）
- 手写工具循环（openai SDK function calling + while loop），不引 LangChain——研究 Agent 只保留 3 个工具（web_fetch / image_search / save_research_note），搜索由代码并行完成，框架是负资产
- 成本可控：单课约 5~7 次 LLM 调用 + 3 次搜索 API（大纲串行），实测 64~146 秒

**关键设计决策**
- 排课引擎是纯函数（输入图谱，输出 nodeId + 理由），可单测、页面可解释"为什么讲这个"。
- 掌握分只允许 `mastery-service` 修改，每次修改必写 `MasteryLog`，满足"看到变化原因"的验收标准。
- LLM 输出全部要求 JSON（structured output / 正则提取兜底），生成失败可重试，不污染已落盘数据。
- Agent 循环设硬上限（最多 12 轮工具调用 / 单阶段超时 90s），超限降级为"用已有笔记直接进入下一阶段"，保证课程总能产出。
- 后续拆独立 Node 服务时，只需把 `services/ + agent/ + llm/ + repo/` 原样搬走，路由层换成 Express 即可。

## 2. 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 语言 | TypeScript（前后端共用） | 领域模型强类型 |
| 前端框架 | Vue 3 `<script setup>` + Vite | PRD 约定 |
| 状态 | Pinia | 图谱/掌握分全局共享 |
| 图谱可视化 | Vue Flow + Dagre（自动布局） | 节点颜色=掌握度，支持增删改 |
| 内容渲染 | markdown-it + Shiki + KaTeX + Mermaid | 课程页；Shiki 预加载常用语言；Mermaid 懒加载渲染 SVG（按代码文本缓存） |
| 配图素材 | 本地素材库 data/topics/&lt;tid&gt;/assets/（内容哈希命名去重）+ assets.json 清单记原图来源 | 下载/上传共用 asset-store；拒 SVG（图示走 Mermaid），限 5MB |
| 后端 | Vite middleware（自写路由，不引入框架） | 路由量小，用 `connect` 风格 handler 足够 |
| LLM | OpenAI 兼容 SDK（openai 包），stream + function calling + 图片多模态 | 供应商实现时通过 .env 切换；deepseek-flash 原生支持 image_url 输入 |
| Agent 运行时 | 手写工具循环（while + tool_calls），不引 LangChain | 备课研究 4 个工具，框架是负资产 |
| 搜索 API | **Tavily + 博查双接**：并行搜索、结果按 URL 去重合并（Tavily 英文/LLM 友好，博查中文生态好，CTR/CVR 中文精华多） | 单家故障时自动降级为另一家；key 进 .env |
| 网页抓取 | fetch + @mozilla/readability + jsdom 提正文 | 备课 Agent 的 web-fetch 工具 |
| 流式传输 | SSE（`text/event-stream`） | 备课阶段进度 + 课程逐 token 渲染 |
| 存储 | 本地 JSON 文件 | repo 层封装，接口对齐未来迁 SQLite |
| 校验 | zod | API 入参 + LLM 输出 schema 校验共用 |
| 工程 | pnpm、ESLint + Prettier、Vitest（排课/掌握分单测） | |

## 3. 数据设计（JSON 文件 = 未来表结构）

文件布局：`data/topics/<topicId>/` 下分文件，单课题数据量小，整文件读写即可。

### 3.1 topic.json — 课题
```jsonc
{
  "id": "t_ctr_cvr",
  "name": "CTR/CVR 预估模型",
  "createdAt": "2026-09-30T10:00:00Z",
  "llmModel": "xxx"            // 生成图谱所用模型，便于追溯
}
```

### 3.1b topic-research.json — 开课调研结论（Agent 产出，图谱生成依据）
```jsonc
{
  "overview": "该学习方向总览",
  "contentAreas": [{ "name": "板块名", "description": "一句话说明" }],  // 8~20 个，按学习顺序
  "keySkills": ["关键能力"],
  "sources": [{ "title": "...", "url": "..." }],
  "researchedAt": "..."
}
```

### 3.2 graph.json — 知识点 DAG
```jsonc
{
  "nodes": [{
    "id": "n_lr",
    "name": "逻辑回归",
    "description": "一句话描述",
    "deps": [],                 // 前置节点 id 列表；写入时校验无环
    "mastery": 0,               // 0-100，红<40 / 黄40-79 / 绿≥80
    "manualEdited": false       // 用户手改过的节点，后续 LLM 不覆盖
  }],
  "updatedAt": "..."
}
```

### 3.3 lessons/<lessonId>.json — 课程
```jsonc
{
  "id": "l_001",
  "nodeIds": ["n_fm"],                 // 本课聚焦的 1~2 个知识点
  "scheduleReason": "n_fm 已解锁（依赖 n_lr=85）且分最低(32)",
  "masterySnapshot": { "n_lr": 85, "n_fm": 32 },   // 备课时注入的学习者状态
  "injectedReports": ["r_003"],        // 备课时注入的历史报错 id
  "researchNoteIds": ["rn_fm"],        // 备课所依据的研究笔记
  "sources": [{ "idx": 1, "title": "...", "url": "..." }],  // 引用来源，页面展示
  "images": [{ "src": "/api/topics/t_x/assets/ab12.png", "alt": "图注",
               "originUrl": "https://...", "pageUrl": "https://..." }],  // 配图清单（图片来源展示；旧课件可无）
  "contentMd": "# 课程 markdown ...",  // 正文含 [1][2] 引用标记；图片 ![图注](src)、图示 ```mermaid
  "status": "generated",               // researching | outlining | writing | generated | failed
  "createdAt": "..."
}
```

### 3.4 lessons/<lessonId>.questions.json — 课末 5 题
```jsonc
{
  "questions": [
    {
      "id": "q_1",
      "nodeId": "n_fm",
      "type": "single",                 // single | judge | short
      "prompt": "题干（md）",
      "options": ["A...", "B..."],      // 客观题才有
      "answer": "B",                    // 客观题标准答案（本地判分用）
      "referenceAnswer": "简答参考答案（LLM 批改对照用）",
      "explanation": "讲解（判分后展示）"
    }
  ]
}
```

### 3.5 attempts/<lessonId>.json — 答题与批改记录（数组，每次交卷追加一条）
```jsonc
[{
  "id": "a_001",
  "lessonId": "l_001",
  "questions": [/* 题目快照，含 answer/referenceAnswer/explanation，回看用 */],
  "records": [{
    "questionId": "q_1",
    "userAnswer": "B" | "简答文本",
    "result": {
      "correct": true,                  // 客观题
      "score": 0.8,                     // 简答：LLM 批改 0~1
      "feedback": "评语 + 思路偏差指正",
      "gradedBy": "local" | "llm"
    },
    "submittedAt": "..."
  }],
  "masteryChanges": [/* 本次掌握分变化（nodeId/nodeName/before/after/delta/reason） */],
  "status": "graded",
  "createdAt": "..."
}]
```
兼容旧版单对象格式（读取时自动包装为数组并回填题目快照）。「再次测验」生成新题集后交卷即追加新记录，互不覆盖。

### 3.6 mastery-log.json — 掌握分变更流水（append-only）
```jsonc
[{
  "id": "m_001",
  "nodeId": "n_fm",
  "before": 32, "after": 45, "delta": 13,
  "reason": "l_001/q_1 答对",           // 页面直接展示
  "sourceType": "question" | "manual",
  "createdAt": "..."
}]
```

### 3.7 reports.json — "这里有错"记录
```jsonc
[{
  "id": "r_003",
  "targetType": "lesson" | "question",
  "targetId": "l_001",
  "nodeId": "n_fm",                     // 归属知识点，供后续备课注入
  "quote": "被标记的段落原文",
  "note": "用户备注（可选）",
  "createdAt": "..."
}]
```

### 3.8 research/<nodeId>.json — 研究笔记（按知识点缓存，Agent 产出）
```jsonc
{
  "id": "rn_fm",
  "nodeId": "n_fm",
  "concepts": ["核心概念要点..."],
  "derivations": ["公式推导（md+LaTeX）..."],
  "examples": ["典型例题/案例..."],
  "pitfalls": ["常见误区..."],
  "sources": [{ "title": "...", "url": "...", "fetchedAt": "..." }],
  "images": [{ "url": "https://.../arch.png", "title": "架构图",
               "pageUrl": "https://.../post", "localPath": "/api/topics/t_x/assets/ab12.png" }],
               // 为课件配图收藏的图片（0~4 张），保存笔记时已下载落地；旧笔记可无此字段
  "searchQueries": ["FM 特征交叉 原理", "..."],   // 已搜过的 query，增量备课去重
  "version": 2,                                    // 每次增量研究 +1
  "updatedAt": "..."
}
```

### 3.9 assets/ + assets.json — 课件配图素材库（按课题）
```
data/topics/<topicId>/
  assets/<sha256前16位>.<png|jpg|gif|webp>   // 内容哈希命名，天然去重（AI 配图下载落地）
  assets.json                                 // { "<file>": { originUrl?, title?, pageUrl?, size, createdAt } }
```
- 课件正文统一引用 `/api/topics/<tid>/assets/<file>`（hash 文件名可长期缓存）；原图 URL 记入清单与 lesson.images 供图注来源
- 下载校验魔数（拒 SVG 防脚本，图示走 Mermaid），单图 ≤5MB；文件名白名单防路径穿越

### 3.10 highlights/<lessonId>.json — 课件划线（按课程）
```jsonc
[{
  "id": "hl_ab12",
  "lessonId": "l_001",
  "nodeId": "n_fm",                     // 归属知识点
  "heading": "梯度下降",                 // 所属章节标题（null = 前言）
  "text": "学习率决定步长",              // 划线原文
  "occurrence": 0,                      // 同章节内第几次出现（0 起），重定位用
  "createdAt": "..."
}]
```
- 锚点用「章节 + 文字 + 出现次序」描述：正文重渲染/编辑后在前端重新定位包裹 `<mark class="lesson-hl">`；定位不到仅不画绿标，记录保留
- 删除课件时一并清除；删除学习方向时随 `data/topics/<tid>/` 整体清除

### 3.11 onboarding/attachments/<id>.json (+ 原图) — 开课对话附件（临时）
```jsonc
{
  "id": "att_ab12cd34",
  "name": "课程大纲.pdf",           // 展示名，已去路径/控制字符
  "kind": "image | text",
  "mime": "application/pdf",
  "size": 123456,
  "format": "pdf | docx | pptx | text | png...",
  "chars": 8321,                    // 文档抽取字数
  "truncated": false,               // 超过 2 万字只保留前 2 万字
  "text": "……",                     // 文档正文（图片不存这里）
  "imageFile": "att_ab12cd34.png",  // 图片原文件名（内容哈希无关，仅随机 id）
  "createdAt": "..."
}
```
- 目录按用户隔离：`data/users/<uid>/onboarding/attachments/`；图片保留原文件供预览与多模态输入，文档只留抽取文本
- 单文件 ≤10MB（图片 ≤8MB）、单条消息最多 3 个；落盘 24 小时后在下一次上传时清理，每人最多保留 20 个
- 只服务开课对话，不并入课题素材库，不做长期资料/RAG；对话消息里只传引用（id/name/kind），正文每次从服务端读取
- PDF 用 zlib 解析内容流 + ToUnicode CMap，DOCX/PPTX 走 ZIP + XML，纯文本按 UTF-8/GB18030 解码；扫描件读不出文字时返回可执行提示

### 掌握分算法规则（mastery-service，MVP 版）
- 客观题：答对 +20，答错 -8（clamp 到 0~100）；每题满分 20
- 简答题：`delta = round((score - 0.2) * 25)`，即 0.2 分及格线（答出点东西就不扣分），满分 +20、0.7 分 +12、零分 -5
- 每次课程完成（5 题全部批改后）额外结算；所有变更写 MasteryLog；delta 为 0 的题也保留原因留痕
- 目标手感：4 客观对 + 简答 0.7 = +92，一次测验即可越过 80 解锁线；部分答对可「再次测验」继续提分
- 阈值（20/8/25/0.2）集中在一个 constants 文件（shared/mastery.ts），便于调参

## 4. API 设计

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/onboarding/chat | 开课对话（多轮引导 → 方向提案）；messages 可带附件引用，图片以多模态 image_url 送入模型 |
| POST | /api/onboarding/attachments | 上传开课附件（原始字节 + `X-File-Name` 头）；图片落原文件，文档抽取正文后只存文本 |
| GET | /api/onboarding/attachments/:id | 图片附件预览（仅当前用户，`nosniff`） |
| DELETE | /api/onboarding/attachments/:id | 移除待发送附件（发送后仍保留 24h，供对话引用） |
| GET | /api/topics | 学习方向列表 |
| POST | /api/topics | 输入方向名 → Agent 联网调研（researching/research-tool 阶段）→ 生成 DAG（SSE 推进度）→ 返回 topic+graph |
| GET | /api/topics/:id/graph | 读取图谱 |
| PATCH | /api/topics/:id/graph | 手动编辑保存，全量替换节点（服务端校验无环） |
| POST | /api/topics/:id/graph/chat | 图谱 AI 对话调整：返回 reply + 修改建议 proposal + diff，前端确认后走 PATCH 应用 |
| GET | /api/topics/:id/lessons | 课程列表（挂到知识点节点，不含正文） |
| POST | /api/topics/:id/lessons | 排课 + 备课 Agent，SSE：`stage(schedule/research-prefetch/research/research-note-saved/outline-done/write/draft-saved/done)`（课末题/质检在后台异步，不占 SSE） + 阶段详情（搜索 query、命中来源）+ 课程流式内容 |
| GET | /api/lessons/:id | 课程 + 题目（题目不含 answer/explanation，防前端偷看） |
| POST | /api/lessons/:id/submit | 交卷：客观题本地秒判 + 简答 LLM 批改，同步返回判分/评语/掌握分变化/MasteryLog/答案揭示；可多次交卷（配合再次测验），每次追加一条 attempt |
| GET | /api/lessons/:id/attempts | 该课全部测验记录（含题目快照/作答/批改/掌握分变化，升序） |
| POST | /api/lessons/:id/questions/regenerate | 再次测验：LLM 围绕本课知识点重新出一套新题（避开历史题目），覆盖当前题集（写 generatedAt 供交卷乐观并发校验） |
| GET | /api/topics/:tid/assets/:file | 课件配图静态资源（hash 文件名，immutable 缓存） |
| PATCH | /api/lessons/:id/content | 手动编辑课件正文（改图表/编辑）：落图 + 版本快照（可撤销）+ 更新配图清单 |
| GET | /api/topics/:id/mastery-log | 掌握分变更历史 |
| POST | /api/reports | 报错标记（课程划词 / 题目） |
| GET | /api/topics/:id/reports | 报错记录列表 |
| GET | /api/lessons/:id/highlights | 该课全部划线（正文绿标 + 划线本面板） |
| POST | /api/lessons/:id/highlights | 新增一条划线（锚点：章节 + 文字 + 出现次序；同锚点去重） |
| DELETE | /api/lessons/:id/highlights/:hid | 删除一条划线 |

前端路由：`/` 学习方向列表（HomeView）、`/topic/:id` 图谱、`/lesson/new?topic=:id` 备课、`/lesson/:id` 课程、`/lesson/:id/exercise` 练习。

## 5. 目录结构

```
hys-tutor/
├─ src/                     # 前端
│  ├─ views/                # HomeView / GraphView / LessonView / ExerciseView
│  ├─ components/           # GraphNode, NodePanel, GraphChatPanel, MarkdownRenderer, SelectionReporter
│  ├─ stores/               # topic.ts, lesson.ts
│  ├─ utils/                # sse.ts, layout.ts(dagre), report.ts
│  └─ styles/
├─ server/
│  ├─ routes/               # topics.ts, lessons.ts, reports.ts, health.ts
│  ├─ services/             # graph / graph-chat / scheduler / lesson-agent / lesson / grading / mastery / report / onboarding-attachments / document-text
│  ├─ agent/                # loop.ts（工具循环）, tools/（web-search / web-fetch / notes）
│  ├─ llm/                  # client.ts, prompts/（topic-research/图谱/graph-chat/研究/大纲/写作/自查/批改）
│  └─ repo/                 # json 读写 + 原子写
├─ shared/                  # types.ts（领域模型 zod）, api.ts（接口 DTO）, dag.ts, mastery.ts
├─ scripts/                 # try-lesson-agent.ts（备课 CLI 冒烟）
├─ tests/                   # vitest 单测
├─ data/                    # 运行时生成，git 忽略：topics.json + topics/<id>/{...}.json + 每用户 users/<uid>/{topics,onboarding/attachments}/
├─ vite.config.ts           # 挂载 server middleware（ssrLoadModule 热载后端）
└─ .env                     # LLM_API_KEY / LLM_BASE_URL / LLM_MODEL / TAVILY_API_KEY / BOCHA_API_KEY
```

## 6. 开发顺序（对应 2 周原型）

1. 工程初始化 + repo 层 + shared types（0.5 天）
2. 图谱：LLM 生成 DAG + Vue Flow 可视化 + 手动编辑（2-3 天）
3. 排课引擎（纯函数 + 单测）（0.5 天）
4. 备课 Agent：工具循环 + web-search/web-fetch/notes 工具 + 研究笔记缓存，先用 CLI 脚本调通（2-3 天）
5. 课程生成 SSE 分阶段进度 + 流式渲染 + 引用来源展示（1-2 天）
6. 练习与批改：客观题秒判 + 简答 LLM 批改 + 掌握分更新联动图谱（2 天）
7. 报错入口 + 备课上下文注入（0.5 天）
8. 真实学 10 轮，按体验调参（掌握分权重、Agent prompt、搜索策略）

## 7. 性能与成本预期（Agent 化后调整）

- 备课全流程平均 < 2 分钟、最慢 < 3 分钟（3 路预搜 + 5~7 次 LLM 调用），页面分阶段展示进度 + 中间产物（搜了什么、读了哪篇），等待可感知不焦虑
- 研究笔记按知识点缓存：同知识点第二次备课省去大部分搜索，< 1 分钟
- 简答批改 < 20s、客观题判分 < 1s 不变
