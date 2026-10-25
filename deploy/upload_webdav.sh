#!/usr/bin/env bash
# 把 dist/ 上传到飞牛 NAS WebDAV（deploy 用；凭据来自 config/sync.nas.local.json）
# 每个文件校验 HTTP 状态码（2xx），失败重试并最终报错
# 用法: bash deploy/upload_webdav.sh [distDir] [remoteSubdir]
set -euo pipefail
cd "$(dirname "$0")/.."

DIST="${1:-dist}"
SUB="${2:-tdxl-pwa/html}"

# 凭据从 config/sync.nas.local.json 读取（不在脚本内硬编码；该文件勿提交仓库）
read -r HOST PORT USER PASS < <(python - <<'PY'
import json, sys
cfg = json.load(open("config/sync.nas.local.json", encoding="utf-8"))
wd = cfg["webdav"]
print(wd["host"], wd["portHttp"], wd["username"], wd["password"])
PY
)
[ -n "${HOST:-}" ] && [ -n "${PASS:-}" ] || { echo "缺少 config/sync.nas.local.json 或 webdav 凭据字段"; exit 1; }
AUTH="$USER:$PASS"
HOST="$HOST:$PORT"
BASE="/%E4%B8%9A%E5%8A%A1/${SUB}"

# 递归建目录（幂等：201 新建 / 405 已存在 都算成功）
mkcol_tree() {
  local encoded
  encoded=$(python - "$1" <<'PY'
import sys, urllib.parse
print(urllib.parse.quote(sys.argv[1].replace('\\','/')))
PY
)
  curl -s -o /dev/null -u "$AUTH" -X MKCOL "http://$HOST$BASE/$encoded" || true
}

count=0; fail=0
while IFS= read -r -d '' file; do
  rel="${file#"$DIST"/}"
  rel_unix="${rel//\\//}"
  dir=$(dirname "$rel_unix")
  if [ "$dir" != "." ]; then mkcol_tree "$dir"; fi
  encoded=$(python - "$rel_unix" <<'PY'
import sys, urllib.parse
print(urllib.parse.quote(sys.argv[1].replace('\\','/')))
PY
)
  ok=0; code=""
  for attempt in 1 2 3; do
    # 本地文件偶发读不到（并发构建/杀软瞬时锁定）不能因 set -e 直接炸掉：
    # 读取失败时 code 置 000，走统一重试，重试耗尽才计失败
    code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 15 --max-time 180 -u "$AUTH" -T "$file" "http://$HOST$BASE/$encoded" 2>/dev/null) || code="000"
    case "$code" in
      20*) ok=1; break ;;
      *) sleep $((attempt*3)) ;;
    esac
  done
  if [ "$ok" -eq 1 ]; then
    count=$((count+1))
  else
    echo "FAIL($code): $rel"
    fail=$((fail+1))
  fi
done < <(find "$DIST" -type f -print0)

echo "== 上传完成: 成功 $count / 失败 $fail =="
[ "$fail" -eq 0 ]
