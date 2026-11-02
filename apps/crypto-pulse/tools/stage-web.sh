#!/usr/bin/env bash
# 把网页版资源同步到一个纯静态目录，用于云端发布（不含安卓工程与 APK）
# 用法: bash apps/crypto-pulse/tools/stage-web.sh [目标目录]
# 默认输出到仓库根的 web-dist/（已 gitignore）
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
REPO=$(cd "$ROOT/../.." && pwd)
OUT=${1:-$REPO/web-dist}

mkdir -p "$OUT"
rm -rf "$OUT/css" "$OUT/js" "$OUT/icons"
for f in index.html newcoins.html manifest.webmanifest sw.js; do
  cp -f "$ROOT/$f" "$OUT/$f"
done
for d in css js icons; do
  cp -rf "$ROOT/$d" "$OUT/$d"
done
echo "已同步到 $OUT"
echo "  文本 $(find "$OUT" -type f \( -name '*.js' -o -name '*.css' -o -name '*.html' \) | wc -l) 个 / 总 $(find "$OUT" -type f | wc -l) 个文件"
