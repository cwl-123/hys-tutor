#!/usr/bin/env bash
set -euo pipefail

# 阿里云 Ubuntu 24.04 首次部署脚本（在项目根目录执行）：
#   sudo bash deploy/install.sh <域名> <证书通知邮箱>
# 前提：DNS A 记录已指向本机；安全组开放 22/80/443；Node 24 与 pnpm 已安装。
if [ "$(id -u)" -ne 0 ]; then
  echo "请用 root / sudo 运行" >&2
  exit 1
fi
DOMAIN="${1:?用法: sudo bash deploy/install.sh <域名> <邮箱>}"
EMAIL="${2:?用法: sudo bash deploy/install.sh <域名> <邮箱>}"

APP_DIR=/opt/hys-tutor
DATA_DIR=/var/lib/hys-tutor
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "未找到 node。请先安装 Node.js 24（推荐 NodeSource 或 nvm），再重跑。" >&2
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 24 ]; then
  echo "需要 Node.js >= 24，当前 $(node -v)。node:sqlite 在 24 上可直接使用。" >&2
  exit 1
fi

echo "[1/8] 安装系统依赖"
apt-get update
apt-get install -y nginx certbot sqlite3 rsync curl ca-certificates

echo "[2/8] 创建运行用户与目录"
id hys >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin hys
mkdir -p "$APP_DIR" "$DATA_DIR/data" /var/www/certbot /var/backups/hys-tutor
chown -R hys:hys "$DATA_DIR"
chmod 700 "$DATA_DIR" /var/backups/hys-tutor

echo "[3/8] 同步代码（保留远端 .env / data / node_modules）"
rsync -a --delete \
  --exclude '.git' --exclude 'node_modules' --exclude 'data' \
  --exclude '.env' --exclude 'dist' --exclude 'dist-server' \
  "$SRC_DIR"/ "$APP_DIR"/

echo "[4/8] 安装依赖并构建"
cd "$APP_DIR"
corepack enable
corepack prepare pnpm@11.7.0 --activate
pnpm install --frozen-lockfile
pnpm build
pnpm build:server
pnpm prune --prod

echo "[5/8] 配置环境变量"
if [ ! -f /etc/hys-tutor.env ]; then
  cp "$APP_DIR/.env.example" /etc/hys-tutor.env
  chmod 600 /etc/hys-tutor.env
  sed -i "s|^APP_ORIGIN=.*|APP_ORIGIN=https://$DOMAIN|" /etc/hys-tutor.env
  echo "已生成 /etc/hys-tutor.env，请填入 LLM_API_KEY / BOOTSTRAP_INVITE_CODE 后重跑本脚本。"
  echo "至少需要：LLM_API_KEY、BOOTSTRAP_INVITE_CODE（首次注册用，之后删除）。"
  exit 0
fi
chmod 600 /etc/hys-tutor.env
if ! grep -q '^LLM_API_KEY=.\+' /etc/hys-tutor.env; then
  echo "警告：/etc/hys-tutor.env 还没有 LLM_API_KEY，登录后生成课程会失败。" >&2
fi
if ! grep -q '^BOOTSTRAP_INVITE_CODE=.\+' /etc/hys-tutor.env; then
  echo "提示：BOOTSTRAP_INVITE_CODE 为空，暂时无法注册第一个管理员；填好后重启 hys-tutor。" >&2
fi
chown hys:hys "$APP_DIR"
chown -R hys:hys "$DATA_DIR"

echo "[6/8] 安装 systemd 服务"
install -m 644 "$APP_DIR/deploy/hys-tutor.service" /etc/systemd/system/hys-tutor.service
install -m 644 "$APP_DIR/deploy/backup.service" /etc/systemd/system/hys-tutor-backup.service
install -m 644 "$APP_DIR/deploy/backup.timer" /etc/systemd/system/hys-tutor-backup.timer
systemctl daemon-reload
systemctl enable --now hys-tutor

echo "[7/8] 首次签发证书（HTTP 引导配置）"
sed "s|__DOMAIN__|$DOMAIN|g" "$APP_DIR/deploy/nginx-bootstrap.conf" > /etc/nginx/conf.d/hys-tutor.conf
nginx -t
systemctl reload nginx
certbot certonly --webroot -w /var/www/certbot -d "$DOMAIN" \
  --non-interactive --agree-tos -m "$EMAIL" --keep-until-expiring

echo "[8/8] 启用 HTTPS 配置"
sed "s|__DOMAIN__|$DOMAIN|g" "$APP_DIR/deploy/nginx-hys-tutor.conf" > /etc/nginx/conf.d/hys-tutor.conf
nginx -t
systemctl reload nginx
systemctl enable --now hys-tutor-backup.timer

echo
echo "部署完成：https://$DOMAIN"
echo "1) 用 /etc/hys-tutor.env 里的 BOOTSTRAP_INVITE_CODE 注册第一个账号（自动成为管理员）"
echo "2) 注册成功后从 env 删除 BOOTSTRAP_INVITE_CODE 并 systemctl restart hys-tutor"
echo "3) 登录后在「管理」页生成邀请码"
echo "4) 检查：curl -sS https://$DOMAIN/api/health"
