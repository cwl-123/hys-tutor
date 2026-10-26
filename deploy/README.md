# hys-tutor 公网部署（阿里云 ECS + Nginx + systemd）

目标拓扑：

```
浏览器 ── HTTPS ──> Nginx :443
                     ├── /assets、/  → /opt/hys-tutor/dist（静态）
                     └── /api/        → 127.0.0.1:5180（Node 单进程）
                                          ├── SQLite  /var/lib/hys-tutor/control.db
                                          └── JSON    /var/lib/hys-tutor/data/users/<uid>/
```

> **必须单进程**：会话锁、备课任务、内存限流都在进程内，不能开 PM2 cluster / 多实例。
> 横向扩展需要先把锁、任务队列、限流迁到 Redis，不在当前范围。

## 1. 机器与网络

- ECS：Ubuntu 24.04，2C4G 起步，系统盘 40G+；数据盘挂到 `/var/lib/hys-tutor` 更稳。
- Node.js **24 LTS**（`node:sqlite` 内置，免编译 better-sqlite3）。
- 安全组开放 **22 / 80 / 443**；5180 只监听 `127.0.0.1`，不要对公网开放。
- DNS：`A` 记录 `your-domain.com → ECS 公网 IP`，先等解析生效。
- 域名已完成 **ICP 备案**；上线后 30 日内完成 **公安联网备案**，页脚放备案号。

## 2. 首次部署

在本地项目根目录执行（脚本会 rsync 到 `/opt/hys-tutor`）：

```bash
# 本地先确认构建通过
pnpm typecheck && pnpm lint && pnpm test && pnpm build

# 上传并执行；把域名、邮箱换成自己的
scp -r . root@<ECS_IP>:/tmp/hys-tutor
ssh root@<ECS_IP>
cd /tmp/hys-tutor
bash deploy/install.sh tutor.example.com you@example.com
```

第一次运行会生成 `/etc/hys-tutor.env` 后退出，编辑它：

```bash
vi /etc/hys-tutor.env
# 必填：
#   LLM_API_KEY=sk-...
#   LLM_BASE_URL=https://api.deepseek.com/v1
#   LLM_MODEL=deepseek-flash
#   BOOTSTRAP_INVITE_CODE=一次性随机串
#   APP_ORIGIN=https://tutor.example.com
# 强烈建议：TAVILY_API_KEY / BOCHA_API_KEY（备课联网研究用；两家都不配时课程退化为模型自有知识，设置页会显示「未配置」）
```

然后重跑：

```bash
bash deploy/install.sh tutor.example.com you@example.com
```

脚本会构建、装 systemd、签证书、切 HTTPS、启动备份 timer。

## 3. 冷启动：第一个管理员

1. 打开 `https://tutor.example.com/register`。
2. 邀请码填 `BOOTSTRAP_INVITE_CODE` 的值，注册第一个账号（自动 `admin`）。
3. 登录后进「管理」，生成邀请码发给内测用户。
4. **从 `/etc/hys-tutor.env` 删除 `BOOTSTRAP_INVITE_CODE`**，然后：
   ```bash
   systemctl restart hys-tutor
   ```

## 4. 验证清单

```bash
systemctl status hys-tutor --no-pager
journalctl -u hys-tutor -n 100 --no-pager
curl -sS https://tutor.example.com/api/health
curl -sS -I https://tutor.example.com/login
nginx -t
```

浏览器验证：

- [ ] 未登录访问 `/` 自动跳 `/login`
- [ ] 邀请码注册 → 自动登录 → 首页
- [ ] 退出后 `/api/topics` 返回 401（DevTools Network）
- [ ] 两个账号互相看不到对方的方向/课程
- [ ] 备课进度条能持续更新（SSE 没被 Nginx 缓冲）
- [ ] 交卷批改正常
- [ ] 「管理」页能生成邀请码、禁用用户、重置密码
- [ ] 手机 4G/另一网络能打开（安全组、备案）
- [ ] 控制台无 CSP 报错、无 404 资源

## 5. 数据与备份

| 数据 | 位置 | 说明 |
|---|---|---|
| 账号/会话/邀请码/用量/反馈 | `/var/lib/hys-tutor/control.db` | SQLite WAL |
| 课程/图谱/偏好/答题 | `/var/lib/hys-tutor/data/users/<uid>/` | 每用户独立目录 |
| 旧单用户数据 | `data/topics`、`data/topics.json`、`data/preferences.json` | 用迁移脚本搬到首个用户目录 |

迁移旧数据（先注册好账号，从管理页或数据库拿到 `u_xxx` id）：

```bash
cd /opt/hys-tutor
sudo -u hys node scripts/migrate-user-data.mjs --user-id u_xxxxxxxx        # 预演
sudo -u hys node scripts/migrate-user-data.mjs --user-id u_xxxxxxxx --apply
```

如果数据已经是本地单用户模式的 `data/users/local/`，用 `--from-user local` 搬到公网账号：

```bash
sudo -u hys node scripts/migrate-user-data.mjs --from-user local --user-id u_xxxxxxxx --apply
```

备份：

```bash
systemctl list-timers hys-tutor-backup.timer
/opt/hys-tutor/deploy/backup.sh
ls -lh /var/backups/hys-tutor/
```

默认保留 7 天。要上 OSS：安装 `ossutil` 并配置 profile，再在 `/etc/hys-tutor-backup.env` 写
`OSS_BUCKET=your-bucket`。**备份文件含用户数据，OSS bucket 必须私有，开服务端加密。**

恢复：

```bash
systemctl stop hys-tutor
cp /var/backups/hys-tutor/control-<时间>.db /var/lib/hys-tutor/control.db
tar -C /var/lib/hys-tutor -xzf /var/backups/hys-tutor/data-<时间>.tar.gz
chown -R hys:hys /var/lib/hys-tutor
systemctl start hys-tutor
```

## 6. 升级

```bash
# 本地
pnpm typecheck && pnpm lint && pnpm test && pnpm build
git push

# 服务器
cd /opt/hys-tutor
sudo -u hys git pull            # 若用 git 部署；否则重新 rsync
sudo pnpm install --frozen-lockfile
sudo pnpm build && sudo pnpm build:server
sudo pnpm prune --prod
sudo systemctl restart hys-tutor
curl -sS https://tutor.example.com/api/health
```

数据库迁移在进程启动时自动跑（`PRAGMA user_version`），升级前仍建议先手动备份。

## 7. 配额与预算

在 `/etc/hys-tutor.env` 调整：

```ini
QUOTA_TOPICS_PER_DAY=5
QUOTA_LESSONS_PER_DAY=10
QUOTA_GRADES_PER_DAY=100
QUOTA_CHATS_PER_DAY=300
MAX_TOPICS_PER_USER=30
DAILY_BUDGET_CNY=50
```

- 预算是**全站当日估算**（按 token × 单价），超过后只挡新的备课/优化，批改和已生成课程仍可用。
- 单价用 `LLM_PRICE_IN_PER_M` / `LLM_PRICE_OUT_PER_M` 校准，否则预算数字会偏差。
- 10 人内测建议先 `DAILY_BUDGET_CNY=50`，观察一周 `usage_events` 再调。

## 8. 合规与内容安全

上线前必须补齐：

- [ ] ICP 备案号放页脚；公安备案通过后放公安备案号与链接
- [ ] 用户协议、隐私政策可访问（`/terms`、`/privacy`），注册必须勾选
- [ ] 课程页与页脚有「AI 生成，请核实」标识
- [ ] 明确第三方：DeepSeek（生成/批改）、Tavily/博查（搜索）、阿里云（托管/备份）
- [ ] 提供举报/反馈渠道（管理页或邮箱），并有人处理
- [ ] 不面向未成年人宣传；隐私政策写明 18 岁/监护人同意
- [ ] 生成内容不得涉及违法有害主题；发现后禁用账号并保留记录

## 9. 常见故障

| 现象 | 排查 |
|---|---|
| 502 | `systemctl status hys-tutor`；`journalctl -u hys-tutor -n 100`；端口是否 5180 |
| 登录 403「跨站请求被拒绝」 | `APP_ORIGIN` 必须与浏览器地址完全一致（含 https、无尾斜杠） |
| 登录后立刻掉线 | HTTPS 下 `COOKIE_SECURE=1`；反向代理是否丢 `X-Forwarded-Proto` |
| 备课进度不动 | Nginx `/api/` 是否 `proxy_buffering off`、`proxy_read_timeout 900s` |
| 注册提示邀请码无效 | 邀请码 7 天过期/单次使用；首个用户用 `BOOTSTRAP_INVITE_CODE` |
| 生成报「缺少 LLM API Key」 | `/etc/hys-tutor.env` 的 `LLM_API_KEY`，重启服务 |
| `node:sqlite` 报错 | Node < 24；升级 Node 或给 `ExecStart` 加 `--experimental-sqlite` |
| 磁盘涨得快 | `du -sh /var/lib/hys-tutor/data/users/*`；清理旧课程/图片；备份是否堆本地 |

## 10. 上线后第一周

- 每天看：`journalctl -u hys-tutor --since today | grep -E 'error|失败|超时'`
- 每天看：管理页「今日花费」、`usage_events` 里异常高的用户
- 收集 3~5 个真实用户反馈，优先修「课程生成失败/卡住」和「登录/邀请码」问题
- 第二周再考虑：邮箱找回、邀请码管理列表、课程导出、OSS 图片直传
