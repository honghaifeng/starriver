#!/usr/bin/env bash
# 备份：db.json + 媒体目录 + config.json，保留最近 N 天
#
# 用法：
#   ./scripts/backup.sh                 # 备份到 ./backups
#   BACKUP_DIR=/data/backups ./scripts/backup.sh
#   KEEP=30 ./scripts/backup.sh         # 保留 30 天（默认 14）
#
# 放进 crontab：
#   30 3 * * * /opt/star-river/scripts/backup.sh >> /var/log/sr-backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."

DATA_DIR="${SB_DATA:-$PWD/data}"
BACKUP_DIR="${BACKUP_DIR:-$PWD/backups}"
KEEP="${KEEP:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
TARGET="$BACKUP_DIR/sr-$STAMP.tgz"

mkdir -p "$BACKUP_DIR"

if [ ! -f "$DATA_DIR/db.json" ]; then
  echo "[$(date '+%F %T')] 找不到 $DATA_DIR/db.json，跳过" >&2
  exit 1
fi

# 只备份数据与配置，不备代码（代码在 git 里）
# 注意：变量后面紧跟中文要用 ${VAR}，否则 bash 会把全角字符当成变量名的一部分
TAR_ARGS=(-czf "$TARGET" -C "$(dirname "$DATA_DIR")" "$(basename "$DATA_DIR")")
if [ -n "${CONFIG_FILE:-}" ]; then
  TAR_ARGS+=(-C "$(dirname "$CONFIG_FILE")" "$(basename "$CONFIG_FILE")")
fi
tar "${TAR_ARGS[@]}"

chmod 600 "$TARGET"
SIZE=$(du -h "$TARGET" | cut -f1)
echo "[$(date '+%F %T')] 已备份 ${TARGET}（${SIZE}）"

# 清理超期备份
if [ "$KEEP" -gt 0 ]; then
  find "$BACKUP_DIR" -name 'sr-*.tgz' -type f -mtime +"$KEEP" -print -delete | while read -r f; do
    echo "[$(date '+%F %T')] 清理超期备份 $f"
  done
fi

# 简单自检：能列出内容才算备份成功
if ! tar tzf "$TARGET" >/dev/null 2>&1; then
  echo "[$(date '+%F %T')] 备份包损坏：$TARGET" >&2
  exit 2
fi
