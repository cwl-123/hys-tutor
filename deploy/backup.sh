#!/usr/bin/env bash
set -euo pipefail

# SQLite 控制面 + 用户内容目录的每日备份。
# 可选上传阿里云 OSS：安装 ossutil 并配置 profile 后，设置 OSS_BUCKET。
DB_PATH="${DB_PATH:-/var/lib/hys-tutor/control.db}"
DATA_ROOT="${DATA_ROOT:-/var/lib/hys-tutor}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/hys-tutor}"
KEEP_DAYS="${KEEP_DAYS:-7}"
STAMP="$(date +%F-%H%M)"
OSS_BUCKET="${OSS_BUCKET:-}"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# .backup 是 SQLite 在线备份，WAL 模式下也安全
sqlite3 "$DB_PATH" ".backup '$BACKUP_DIR/control-$STAMP.db'"
tar -C "$DATA_ROOT" -czf "$BACKUP_DIR/data-$STAMP.tar.gz" data

find "$BACKUP_DIR" -type f -mtime "+$KEEP_DAYS" -delete

if [ -n "$OSS_BUCKET" ]; then
  ossutil cp "$BACKUP_DIR/control-$STAMP.db" "oss://$OSS_BUCKET/hys-tutor/control-$STAMP.db" -f
  ossutil cp "$BACKUP_DIR/data-$STAMP.tar.gz" "oss://$OSS_BUCKET/hys-tutor/data-$STAMP.tar.gz" -f
fi

echo "backup ok: $BACKUP_DIR/control-$STAMP.db"
