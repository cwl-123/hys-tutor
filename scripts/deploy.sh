#!/bin/bash
# 重新构建并重启常驻服务（launchd）。代码改动影响运行态时必须执行。
set -e
cd "$(dirname "$0")/.."

echo "==> 构建前端 + 服务端"
pnpm build
pnpm build:server

LABEL="com.hys-tutor"
UID_NUM=$(id -u)
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

if launchctl print "gui/$UID_NUM/$LABEL" >/dev/null 2>&1; then
  echo "==> 重启常驻服务"
  launchctl kickstart -k "gui/$UID_NUM/$LABEL"
else
  echo "==> 首次加载常驻服务"
  launchctl bootstrap "gui/$UID_NUM" "$PLIST"
fi

sleep 2
PORT=$(grep -E '^PORT=' .env | cut -d= -f2 || true)
PORT=${PORT:-5180}
curl -sf "http://localhost:$PORT/api/health" >/dev/null && echo "==> 部署完成：http://localhost:$PORT" || {
  echo "!! 健康检查失败，查看日志：logs/serve.err.log" >&2
  exit 1
}
