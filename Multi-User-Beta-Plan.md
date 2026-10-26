# 单机版 → 多用户公网 Beta 改造计划

> 状态：规划中（2026-10-14 制定；2026-10-26 补充详细设计）。目标：以最小成本上线邀请制 Beta，获取真实用户反馈驱动迭代，不做完整产品化。
>
> **详细技术设计见 [`Launch-Design.md`](Launch-Design.md)**（账号、存储、模型、安全、阿里云部署、验收清单）。本文保留路线判断与范围，二者冲突时以 Launch-Design 为准。
>
> 其中一处选型调整：控制面（账号/会话/邀请码/配额/用量/反馈）改用 SQLite，课程内容仍为按用户隔离的 JSON；原因与迁移触发条件见 Launch-Design §4。

## 目标与路线判断

核心诉求：**有用户、有反馈，才能迭代**。当前仅作者单机使用。

| 路线 | 用户摩擦 | 工作量 | 反馈质量 |
|---|---|---|---|
| A. 托管 Beta（一台 VPS + 邀请码） | 低，发链接就能用 | ~1 周 | 高，能观察真实使用 |
| B. 开源自部署（用户自带 key） | 高，仅技术用户可行 | ~2 天 | 低，装起来的人太少 |

**选定路线 A**：目标用户（学 CTR/CVR 的算法工程师）也懒得本地装 Node + 配 key。

## 改造清单（按依赖顺序）

### 1. 认证 + 用户上下文（1~1.5 天）— 最大的一块
- 邀请码注册 + session cookie
- `server/index.ts` 手写路由加 auth 中间件，把 `userId` 注入所有 handler
- 现状全链路无 user 概念（前端 stores、路由、service 均无），需贯穿：路由 → 18 个 service → 存储路径

### 2. 数据按用户隔离（1~1.5 天）
- `server/repo/json-store.ts` 的 `dataPath` 加 userId 维度：`data/users/<uid>/topics/...`
- `preferences.json`、`topics.json` 从全局文件变 per-user
- 目录结构规整、测试已有 `HYS_DATA_DIR` 注入点，属机械改造
- **JSON 文件先不迁 SQLite**（单进程 + 几十用户并发完全扛得住）

### 3. 任务系统按用户加锁（0.5 天）
- `server/services/lesson-jobs.ts` 的 `runningByTopic` 内存 Map 改为 `userId:topicId` 键
- 单进程内存态先保留，不做水平扩展

### 4. LLM 配额与防滥用（0.5~1 天）
- 服务端继续用作者的 key（`getLLM()` 全局单例不动）
- per-user 每日备课/批改次数限制 + 简单限流
- `data/settings.json` 明文 key 移出数据目录，只留服务端 env

### 5. 前端登录态（0.5~1 天）
- 登录/注册页 + auth store + fetch 统一带凭据、401 跳登录

### 6. 反馈收集入口（0.5 天）— 直接服务核心目的
- 全局「反馈」按钮（复用现有 `src/utils/report.ts` 报错通道，扩展到体验类反馈）
- 后台可看所有用户的报错/反馈 + 使用行为（课程打开率、练习完成率）

### 7. 部署上线（0.5 天）
- VPS + HTTPS + systemd
- 大陆用户访问需备案域名；或先海外机 + 免备案域名试跑
- 域名：申请中（作者负责）

**合计：约 5~6.5 人天**。现有 28 个测试文件覆盖 service 层，改造中回归有保障。

## 明确推迟的（Beta 阶段不做）

- SQLite / Postgres 迁移
- 多实例水平扩展（内存锁 `withLock`、lesson-jobs 内存态维持单进程假设）
- 真正账号体系（邮箱/微信登录）
- 付费计费、BYOK（访客自带 key）

## 持续成本预估

- VPS：€4~5/月（Hetzner 级别足够）
- LLM：备课一次约几分钱到几毛；50 个活跃用户 + 每日配额封顶，月成本预计 < ¥100

## 代码调研关键结论（改造依据）

- 有利面：service 层隔离良好（路由不直接碰文件）、领域逻辑纯函数化（`shared/` 803 行无状态）、mastery-service 是唯一掌握分写入口
- 最不利设计点（按严重度）：
  1. `lesson-jobs.ts` 进程内存 Map（任务状态/进度回放），且 `runningByTopic` 隐含"一个课题只有一个用户"假设
  2. `json-store.ts` 的 `withLock` 内存锁仅单进程有效
  3. `llm/client.ts` 全局单例 cached client + 无参 `getLLM()`，无请求级上下文
  4. `DATA_DIR` 模块加载时固化，路径无用户维度
  5. `preferences.json` 全局学习者画像，天然 per-user 数据却是全局文件
- 测试全部覆盖后端 service + shared 纯逻辑，Vue 组件/stores 零测试
