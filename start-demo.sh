#!/usr/bin/env bash
# 体验环境：独立数据目录 + 独立端口 + 独立账号，正式库与主账号一个字节都不碰
#
# 用法：
#   ./start-demo.sh                 # 只给本机看（127.0.0.1:7788）
#   LAN=1 ./start-demo.sh           # 同一 WiFi 下的人可以访问（http://<本机IP>:7788）
#   PORT=8080 ./start-demo.sh       # 换端口
#   DEMO_PASS=yyy ./start-demo.sh   # 换体验账号密码（立即生效，不用重建数据）
#   DEMO_INVITE=1 ./start-demo.sh   # 开放邀请码自助注册，让外人自己建号
#   ./start-demo.sh --reset         # 清空体验库里所有人留下的会话/资产，回到干净状态
set -euo pipefail
cd "$(dirname "$0")"

# node 探测顺序：显式 NODE_BIN → PATH 里的 node → 常见安装位置
NODE="${NODE_BIN:-$(command -v node || true)}"
if [ -z "$NODE" ]; then
  for c in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
    [ -x "$c" ] && NODE="$c" && break
  done
fi
if [ -z "$NODE" ]; then echo "找不到 node，请先安装 Node 18+（推荐 22）" >&2; exit 1; fi

export SB_DATA="$PWD/data-demo"
export PORT="${PORT:-7788}"
export DEMO_USER="${DEMO_USER:-demo}"
export DEMO_PASS="${DEMO_PASS:-star-river-2026}"
[ "$LAN" = "1" ] && export SB_HOST=0.0.0.0

if [[ " $* " == *" --reset "* ]]; then
  echo "重置体验库（清空会话 / 资产 / 台账，保留语料与账号）…"
  "$NODE" scripts/make-demo-env.mjs --force || exit 1
else
  "$NODE" scripts/make-demo-env.mjs || exit 1
fi

if [ "$LAN" = "1" ]; then
  IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
  echo ""
  echo "体验环境（局域网）→ http://${IP:-<本机IP>}:$PORT"
else
  echo ""
  echo "体验环境 → http://127.0.0.1:$PORT"
fi
echo "账号：$DEMO_USER ／ 密码：$DEMO_PASS"
echo "额度：$("$NODE" -e "console.log(require('$SB_DATA/db.json').org.balance)") 积分（用完自动拦，不会动正式账）"
echo ""
exec "$NODE" server.js
