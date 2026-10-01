#!/bin/bash
# 重新构建并重启常驻服务（launchd）。代码改动影响运行态时必须执行。
set -e
cd "$(dirname "$0")/.."
PROJECT_DIR="$(pwd)"

echo "==> 构建前端 + 服务端"
pnpm build
pnpm build:server

LABEL="com.hys-tutor"
UID_NUM=$(id -u)
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

echo "==> 生成 launchd 配置"
mkdir -p logs
sed -e "s|__PROJECT_DIR__|$PROJECT_DIR|g" -e "s|__NODE_PATH__|$(command -v node)|g" \
  "scripts/$LABEL.plist.template" > "$PLIST"

if launchctl print "gui/$UID_NUM/$LABEL" >/dev/null 2>&1; then
  echo "==> 重启常驻服务"
  launchctl bootout "gui/$UID_NUM/$LABEL" || true
fi
# bootout 后立即 bootstrap 可能偶发 I/O 错误，重试几次
for i in 1 2 3 4 5; do
  launchctl bootstrap "gui/$UID_NUM" "$PLIST" 2>/dev/null && break
  sleep 1
done

sleep 2
PORT=$(grep -E '^PORT=' .env | cut -d= -f2 || true)
PORT=${PORT:-5180}
curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null && echo "==> 部署完成：http://127.0.0.1:$PORT" || {
  echo "!! 健康检查失败，查看日志：logs/serve.err.log" >&2
  exit 1
}
