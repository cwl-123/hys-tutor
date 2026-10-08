# Changelog

版本记录：每次改动提交 git 并在此追加「版本 + 日期 + 功能点」。

## v0.22.0 - 2026-10-08

- 课件配图与图表（文字讲不清的用图解决）：① 备课 Agent 新增 image_search 双路图搜（Tavily include_images / 博查 web-search images）+ web_fetch 附页面配图候选，研究笔记收藏 0~4 张贴切配图并**下载落地**到 data/topics/<tid>/assets/（内容哈希命名去重，assets.json 记原图来源）；② 写作提示词产出 ```mermaid 图（每课 1~3 张）与 ![图注](localPath) 配图（0~2 张），自查/AI 优化保留已有图示；③ 新增落图后处理 localizeImages：残留外链图下载改写本地引用、失败（编造 URL）剔除，生成 lesson.images 供图片来源展示
- 渲染层：MarkdownRenderer 图片渲染 figure+图注+懒加载，Mermaid 懒加载渲染 SVG（按代码文本缓存，流式期间不重复渲染，语法错误保留代码块）；题目页/流式草稿同管道自动受益
- 手动插图：章节「插图」按钮 + 粘贴截图 + 拖拽图片（编辑模式插入光标处），上传走 POST /api/topics/:tid/assets（魔数校验，仅 PNG/JPEG/GIF/WEBP，≤5MB，拒 SVG）
- 图表与正文可改：Mermaid 图悬停「编辑图表」（代码 + 实时预览）；「编辑正文」markdown 实时预览编辑；新增 PATCH /api/lessons/:id/content，手动修改与 AI 对话修改同享版本快照可撤销（对话应用/撤销同样落图并同步配图清单）
- 新增 server/services/asset-store.ts（下载/上传/落图）+ server/routes/assets.ts + shared/lesson-md.ts 增补 appendToSection/replaceMermaidBlock；单测 82 个（asset-store 10 / 图搜与提图 / lesson-md 新增 6）
- PRD 同步至 v1.15.0（功能 6：课件配图与图表）

## v0.21.0 - 2026-10-08

- 课件 AI 对话式优化：课件页新增右侧对话面板，可多轮跟 AI 交互打磨课件（讲不通俗/展开某节/基础差整篇重写等）；对话历史按其课件持久化
- 引用与局部修改：新增 shared/lesson-md.ts（章节解析/标题定位/整节替换纯函数 + 10 个单测）；「改本节」悬停按钮 + 划词「引用这段」浮层；AI 自动判断范围，局部诉求只换相关章节、整体诉求才整篇重写
- 先预览后应用 + 撤销：AI 给修改建议（带改动范围/摘要），可预览目标章节或全文，确认后应用；每次应用写版本快照（保留 20 版），支持撤销最近一次
- 新增 API：GET/POST /api/lessons/:id/chat、POST /chat/apply、POST /chat/undo；chat 记录 data/topics/<tid>/lesson-chats/，版本 data/topics/<tid>/lesson-versions/
- 应用修改不自动重出题（提示用「再次测验」刷新）；原「AI 优化本课」保留为整篇重写+重出题快速通道
- PRD 同步至 v1.14.0

## v0.20.0 - 2026-10-08

- 随堂练习答题记录回看：attempts 改为多次记录数组（题目快照+作答+批改+掌握分变化），新增 GET /api/lessons/:id/attempts；练习页交卷后/再次进入默认展示最近记录，多次测验 pill 切换；兼容旧版单对象格式
- 再次测验：新增 POST /api/lessons/:id/questions/regenerate，LLM 围绕同知识点出 3 道新题（避开历史题目，quiz prompt 独立）；题集写 generatedAt，交卷乐观并发校验防旧题集误交
- 掌握分调参：客观 +15/-5，简答 (score-0.5)*30；delta 为 0 的题也写 MasteryLog 留痕（修复"3 题对 2 错 1 只 +2 分"体验）
- PRD 同步至 v1.13.0

## v0.19.0 - 2026-10-01

- 移除课程页划词「这里有错」弹窗（SelectionReporter 组件删除）：划词即弹窗干扰阅读/复制；题目页报错按钮保留，报错注入备课机制不变
- PRD 同步至 v1.12.0

## v0.18.2 - 2026-10-01

- 修复：LLM JSON 输出含未转义英文双引号导致备课末尾自查出题 3 次重试全败、整课失败（英语口语等语言类课题高发）——extractJson 增加未转义引号修复兜底（repairJson 状态机），大纲/自查/批改 prompt 明确禁用未转义引号
- 排障加固：completeJson 校验失败时服务端记录 finishReason + 内容预览；备课/优化失败原因写入 lesson.error 落盘并 console.error 进 serve.err.log；节点面板失败标签 hover 显示原因

## v0.18.1 - 2026-10-01

- 开源准备：补充 MIT LICENSE（署名 haiyeshu）、重写 README（功能/快速开始/配置/部署/安全隐私）；package.json 去 private、补 license/author/keywords
- 安全：常驻服务绑定 127.0.0.1（原绑 0.0.0.0，局域网可读到设置接口返回的真实 key）
- plist 脱敏：scripts/com.hys-tutor.plist 移出仓库改为 .template 模板，deploy.sh 部署时自动替换项目路径与 node 路径生成；.gitignore 增补 .DS_Store / .env.local 等
- 全库明文密钥扫描（含 git 历史）：无泄漏

## v0.18.0 - 2026-10-01

- Key 编辑所见即所得：模型源 API Key 与搜索 Key 输入框直接回填真实值（本机单用户场景，/api/settings 直返真实 key），眼睛图标切换明文/掩码；废弃「留空保持不变」语义，清空即清除 key（PATCH apiKey undefined=保持、空串=清除）

## v0.17.1 - 2026-10-01

- 设置窗口去 .env 概念化：模型源列表移除「.env 默认」行，「当前生效」只显示模型 + 来源名（兜底源改称「默认配置」）；搜索 Key placeholder 直接显示当前生效的脱敏 Key，没有则留空待填；底部提示简化为「配置仅保存在本机」

## v0.17.0 - 2026-10-01

- 搜索 API Key 页面可配置：设置窗口新增 Tavily / 博查 Key（留空保持原 key，附官方申请链接），resolveSearchKeys 统一解析（页面设置 > .env），web-search 改走该入口
- 两家搜索 key 全缺时报错改为明确提示去设置页配置
- 新增 resolveSearchKeys 单测 3 个（共 43 个）
- PRD 同步至 v1.11.0

## v0.16.0 - 2026-10-01

- 模型源一键导入：扫描本机 OpenCode / Codex / Claude Code 配置（GET /api/settings/import-candidates 脱敏预览，POST /api/settings/import 服务端直读 key 写入，不经过前端），AiHubMix 来源过滤不导入，Claude Code 仅自定义网关可导入
- 设置窗口 UI 精简：模型源列表只显示名称 + 模型 + 缺 Key 警告，去掉 BaseURL/脱敏 Key 细节
- 模型预设补充 kimi-k3 / claude-fable-5-1 / gpt-6-astra
- 新增 import-service 单测 5 个（共 40 个）
- PRD 同步至 v1.10.0

## v0.15.2 - 2026-09-30

- 修复：AI 优化的自查出题改为尽力而为——模型 JSON 输出异常时保留重写正文与原有题目，不再整单失败

## v0.15.1 - 2026-09-30

- 修复：AI 优化任务自锁（runner 先置 revising 状态导致 reviseLesson 自检拒绝），优化流程恢复可用
- 修复：NodePanel 删除确认内联多语句导致生产构建失败
- AGENTS.md：前端模板改动后验证加跑 pnpm build

## v0.15.0 - 2026-09-30

- 课件管理：列表状态前置（备课中/优化中/失败标签）；课件可删除（DELETE /api/lessons/:id，二次确认，连带题目与答题记录）
- AI 优化本课：POST /api/lessons/:id/revise 后台任务，按用户意见基于原研究笔记重写全文 + 重新出题，进度复用回连机制，失败保留原内容；课程页显示最近优化时间
- 模型设置预置 opencode 的 5 个模型源（阿里百炼/AiHubMix/DeepSeek/Kimi/小米），激活源阿里百炼
- LLM JSON 校验重试 2→3 次
- PRD 同步至 v1.9.0

## v0.14.0 - 2026-09-30

- 多模型源支持：设置窗口改为模型源列表（名称/BaseURL/Key/模型），可增删改、单选切换激活源；所有 LLM 调用走激活源，未配置时回退 .env
- 设置窗口展示「当前生效」模型与来源；旧版单配置 settings.json 自动迁移为默认模型源
- PRD 同步至 v1.8.0

## v0.13.1 - 2026-09-30

- 修复：发起备课的 POST 未捕获异常时页面永久停留"加载中"（如部署重启瞬间点击）；现统一进错误态并提供「重新备课」
- 体验：点击开课后立即进入进度视图（"正在发起备课任务…"），消除任何只显示"加载中"的窗口期；复用已有在途任务时给出提示

## v0.13.0 - 2026-09-30

- 模型设置窗口：顶栏「⚙ 设置」可配置 LLM 模型名 / API Base URL / API Key（key 脱敏展示、留空保持不变），存 data/settings.json，优先级高于 .env，保存后调研/备课/批改立即生效；模型名带常用预设下拉

## v0.12.0 - 2026-09-30

- 备课后台任务化：POST /api/topics/:id/lessons 立即返回 lessonId，备课在服务端后台跑；新增 GET /api/lessons/:id/progress（SSE 回放+直播），离开页面再回来自动重连进度，服务重启后僵尸任务标记 failed 可重试
- 课程列表/面板对「备课中/失败」状态可见；练习页对未生成课程给出引导
- SSE 写安全化 + 15s 心跳 + 进程级异常兜底：客户端断开不再炸进程，在途备课继续跑完落盘
- 模型配置服务端化：settings-service（data/settings.json 覆盖 .env），/api/settings GET/PATCH

## v0.11.0 - 2026-09-30

- 指定节点开课：POST /api/topics/:id/lessons 支持 body.nodeId；节点面板「学这个知识点 / 再学一遍」按钮（前置未达标锁定并提示原因）
- 工具栏「开始下一课」加 tooltip 说明自动排课语义；课程页 scheduleReason 区分"排课引擎选择/你指定学习"
- PRD 同步至 v1.6.0

## v0.10.0 - 2026-09-30

- 知识点面板只读化：移除编辑表单/删除按钮/保存机制与冗余说明文字；改为信息卡（描述、掌握度分数+等级+进度条+80 解锁线、前置依赖、历史课程）
- 图谱增删改统一走「AI 调整」对话；工具栏移除「+ 新增知识点」「保存修改」
- PRD 同步至 v1.5.0（手动编辑验收项由 AI 对话调整替代）

## v0.9.0 - 2026-09-30

- 部署常驻化：新增 server/standalone.ts 生产服务器（dist 静态托管 + 同进程 /api），launchd 常驻（com.hys-tutor，开机自启/崩溃自拉起），地址 http://localhost:5180
- `pnpm deploy` 一键重新部署（构建 + 重启 + 健康检查）；AGENTS.md 固化规则：改动后必须部署，不再让用户手动跑 dev
- 修复：ExerciseView 模板内联多语句/TS 断言导致生产构建失败（改为方法调用）

## v0.8.0 - 2026-09-30

- 图谱页交互修正：面板修改实时反映到画布（移除含义模糊的「应用」按钮，落盘统一走工具栏「保存修改」）
- 删除节点降为底部次要操作：二次确认 + 提示下游依赖数与历史课程数
- 图谱页 UI 优化：节点卡片改白底+掌握度色条+圆点分数（不再整片红底），画布加缩放/适配控件，图例改圆点语义化（未掌握/学习中/已掌握）

## v0.7.0 - 2026-09-30

- 首页 UI 重做：hero 大标题 + 引导式创建卡片（风格/程度 chip 选择 + 自定义要求输入）+ 方向卡片网格（统计：知识点/课程/最近学习 + 个性化标签），空间利用与视觉层级全面提升

## v0.6.0 - 2026-09-30

- 方向个性化设置：topic.profile（style 讲解风格 / level 当前程度 / extra 自定义要求），创建时传入并持久化
- 个性化注入：profile 注入图谱生成 prompt（程度影响知识点取舍）+ 备课学习者上下文（大纲/写作全程生效）
- GET /api/topics 返回统计（nodeCount/lessonCount/lastLessonAt）供首页卡片
- PRD 同步至 v1.4.0

## v0.5.0 - 2026-09-30

- 知识点面板前置依赖交互重做：只展示已选依赖（chip 带 × 可移除），添加改为搜索式下拉；候选自动排除自身与下游节点（防成环）

## v0.4.0 - 2026-09-30

- 开课 AI 调研：新方向创建时 Agent 先联网调研知识体系（搜索+精读，结论落盘 topic-research.json 并注入图谱生成 prompt），调研失败降级直接生成；前端实时展示调研搜索词/精读页
- 图谱 AI 对话调整：POST /api/topics/:id/graph/chat，AI 返回修改建议 + diff（新增/删除/修改），前端「应用修改」确认后落盘；破环/悬空依赖自动修复，掌握分不被 AI 修改（6 个单测覆盖）
- PRD 同步至 v1.3.0

## v0.3.0 - 2026-09-30

- 学习方向维度：首页改为学习方向列表（HomeView），可随时开启新方向；图谱页按 `/topic/:id` 进入
- 开课入口带方向参数（`/lesson/new?topic=:id`），课程/练习页面包屑返回所属方向图谱
- PRD 同步至 v1.2.0（多课题列表提前纳入 MVP，课题间迁移仍留二期）

## v0.2.0 - 2026-09-30

- 课程挂载到知识点节点：新增 GET /api/topics/:id/lessons 课程列表 API（标题取课程一级标题）
- 图谱节点显示历史课程数角标（📖 n），点击节点面板内可直接进入该知识点的历史课程

## v0.1.0 - 2026-09-30

MVP 核心闭环（功能 1-7）：

- 工程初始化：Vue3 + Vite 单进程（dev middleware 承载后端 API）、TS 全栈、JSON 文件存储（原子写）、zod 领域模型
- 知识图谱：LLM 生成 15~40 节点 DAG（校验+破环修复+重试）、Vue Flow 可视化（红黄绿掌握度）、手动编辑（服务端无环校验）
- 排课引擎：纯规则「前置≥80 且自身分最低」，输出可解释选题理由
- 备课 Agent：Tavily+博查双路搜索 → 网页精读 → 研究笔记（按知识点缓存）→ 大纲 → 流式写作（带来源引用）→ 自查出题；手写工具循环，硬上限 12 轮
- 课程页：SSE 分阶段备课进度 + markdown-it/KaTeX/Shiki 流式渲染 + 参考来源列表
- 随堂练习：客观题本地秒判、简答题 LLM 批改（分数+评语），掌握分联动图谱并写 MasteryLog 流水
- 报错入口：课程划词报错 + 题目报错，注入同知识点后续备课上下文
- 质量：29 个单测，typecheck / lint / test 全绿；备课全流程实测 154s（缓存命中约 1 分钟）
