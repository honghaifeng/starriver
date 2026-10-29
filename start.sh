#!/usr/bin/env bash
# 春科 · 星河 StarRiver · 启动脚本（正式库）
#
#   ./start.sh              本机 http://127.0.0.1:7777
#   PORT=8080 ./start.sh    换端口
#   SB_HOST=0.0.0.0 ./start.sh   让局域网/公网访问（注意安全边界，见 docs/05-security.md）
set -euo pipefail
cd "$(dirname "$0")"

# node 探测顺序：显式 NODE_BIN → PATH 里的 node → 常见安装位置
NODE="${NODE_BIN:-$(command -v node || true)}"
if [ -z "$NODE" ]; then
  for c in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
    [ -x "$c" ] && NODE="$c" && break
  done
fi
if [ -z "$NODE" ]; then
  echo "找不到 node，请先安装 Node 18+（推荐 22）：https://nodejs.org" >&2
  exit 1
fi

echo "启动 → http://${SB_HOST:-127.0.0.1}:${PORT:-7777}"
exec "$NODE" server.js
