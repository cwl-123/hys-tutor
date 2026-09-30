# hys-tutor

本地部署的 AI 自适应私教：针对课题持续生成多轮个性化微课，练习批改更新知识点掌握度，形成"诊断 → 排课 → 讲解 → 练习 → 反馈"闭环。

- 需求：[Product-Spec.md](./Product-Spec.md)
- 架构/数据设计：[Design.md](./Design.md)

## 运行

```bash
pnpm install
cp .env.example .env   # 填入 LLM / 搜索 API key（.env 不入库）
pnpm dev               # http://localhost:5173，API 走同端口 /api
```

## 常用命令

| 命令 | 说明 |
|---|---|
| `pnpm dev` | 开发（前端 + /api 中间件同进程） |
| `pnpm typecheck` | vue-tsc 类型检查 |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest 单测 |
| `pnpm build` | 类型检查 + 构建 |

## 结构

```
src/       前端（Vue 3 + Pinia + Vue Flow）
server/    后端（Vite middleware：routes / services / agent / llm / repo）
shared/    前后端共用领域模型（zod schema + 类型）
data/      本地 JSON 学习数据（运行时生成，git 忽略）
tests/     Vitest 单测
```
