#!/bin/sh
# 把最新打包好的 dist/protocol-tool.html 同步到 gh-pages 分支，更新 GitHub Pages 在线版。
# 用法：发版后在仓库根目录执行 sh scripts/publish-pages.sh
# 要求：已打包（python3 build.py）、gh-pages 分支已存在且 Pages 已开启。
set -e
cd "$(dirname "$0")/.."
python3 build.py
BRANCH=gh-pages
FILE=dist/protocol-tool.html
[ -f "$FILE" ] || { echo "缺少 $FILE，先跑 python3 build.py"; exit 1; }
WORKTREE=$(mktemp -d)
trap 'rm -rf "$WORKTREE"' EXIT
git worktree add --detach "$WORKTREE" "$BRANCH" >/dev/null 2>&1
cp "$FILE" "$WORKTREE/index.html"
cd "$WORKTREE"
git add index.html
if git diff --cached --quiet; then
  echo "在线版已是最新，无需更新"
else
  git commit -m "更新在线版（$(git -C "$OLDPWD" describe --tags --always 2>/dev/null || git -C "$OLDPWD" rev-parse --short HEAD)）" >/dev/null
  git push origin "HEAD:$BRANCH"
  echo "已发布到 https://dongweiq.github.io/protocol-tool/"
fi
git worktree remove --force "$WORKTREE" 2>/dev/null || true
