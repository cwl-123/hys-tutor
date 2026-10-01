# hys-tutor

本地部署的 AI 自适应私教：针对一个学习方向持续生成多轮个性化微课，通过随堂练习批改迭代知识点掌握度，形成「诊断 → 排课 → 讲解 → 练习 → 反馈」闭环。

区别于一次性生成测验/闪卡类工具：**多轮课程 + 学习者模型持续迭代**，每一节课的内容都建立在你此前的掌握度、错题和报错反馈之上。

## 功能特性

- **学习方向管理**：输入方向（如「CTR/CVR 预估模型」），AI 先联网调研知识体系，再生成带依赖关系的知识点 DAG（15~40 节点）
- **知识图谱**：Vue Flow 可视化，掌握分红黄绿三色（<40 / 40-79 / ≥80），≥80 解锁下游节点；图谱调整通过自然语言对话完成（AI 给 diff 预览，确认后应用）
- **自适应排课**：纯规则引擎（掌握分 + DAG 拓扑），自动选「前置已掌握、自身掌握分最低」的节点开课，也可指定节点
- **Agent 备课**：搜索研究（笔记按知识点缓存）→ 大纲（注入掌握度快照/错题/报错）→ 写作（带来源引用）→ 自查出题，全流程分阶段进度可见
- **练习与批改**：每课 15 分钟微课 + 课末 3 题；客观题秒判，简答题 LLM 批改，按分数比例增减掌握分（每次变更留痕 MasteryLog）
- **多模型源**：页面配置多个 OpenAI 兼容模型源并一键切换；支持扫描本机 OpenCode / Codex / Claude Code 配置一键导入
- **课件管理**：备课/优化状态前置、课件删除、「AI 优化本课」按意见重写

## 快速开始

要求：macOS + Node.js ≥ 22 + pnpm

```bash
git clone <repo-url> && cd hys-tutor
pnpm install
cp .env.example .env   # 填入 LLM / 搜索 API key（也可稍后在页面「设置」里填）
pnpm dev               # http://localhost:5173
```

配置项（`.env` 或页面右上角「⚙ 设置」，页面配置优先）：

| 变量 | 说明 |
|---|---|
| `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` | OpenAI 兼容 LLM（需支持流式 + function calling） |
| `TAVILY_API_KEY` / `BOCHA_API_KEY` | 联网搜索（双路并行互为备份，申请：[Tavily](https://tavily.com) / [博查](https://open.bochaai.com)） |
| `PORT` | 常驻服务端口，默认 5180 |

## 常驻部署（可选，仅 macOS）

```bash
pnpm deploy   # 构建 + 安装/重启 launchd 服务 + 健康检查
```

以 launchd 常驻运行（`com.hys-tutor`），开机自启、崩溃自拉起，访问 http://127.0.0.1:5180 。

## 常用命令

| 命令 | 说明 |
|---|---|
| `pnpm dev` | 开发（前端 + /api 中间件同进程） |
| `pnpm typecheck` | vue-tsc 类型检查 |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest 单测 |
| `pnpm build` | 类型检查 + 生产构建 |
| `pnpm deploy` | 构建并重启 launchd 常驻服务 |

## 技术栈

Vue 3 `<script setup>` + Vite + Pinia + Vue Flow；markdown-it + Shiki + KaTeX 渲染；后端为 Vite 中间件/Node 原生 HTTP（不引框架），TypeScript 前后端共用；本地 JSON 文件存储；备课 Agent 为手写工具循环（搜索 + 网页抓正文 + 研究笔记）。

## 项目结构

```
src/       前端（Vue 3 + Pinia + Vue Flow）
server/    后端（routes / services / agent / llm / repo）
shared/    前后端共用领域模型（zod schema + 类型）
data/      本地 JSON 学习数据（运行时生成，git 忽略）
tests/     Vitest 单测
scripts/   部署脚本（launchd）
```

## 安全与隐私

- 所有学习数据、API key 仅存本机（`data/` 与 `.env`，均已 gitignore），不上云
- 服务仅监听 `127.0.0.1`，不暴露到局域网
- key 仅通过 `.env` / 服务端环境变量注入，前端代码不包含任何密钥

## 文档

- 需求：[Product-Spec.md](./Product-Spec.md)（[变更记录](./Product-Spec-CHANGELOG.md)）
- 架构/数据设计：[Design.md](./Design.md)
- 版本记录：[CHANGELOG.md](./CHANGELOG.md)

## License

[MIT](./LICENSE) © haiyeshu
