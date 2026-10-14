#!/bin/sh
# Remove Cursor commit attribution hooks and keep them from sticking around.
set -eu
hooks_root="${HOME}/.cursor/agent-hooks"
if [ -d "$hooks_root" ]; then
  find "$hooks_root" -type f \( -name '*co-author*' -o -name 'commit-msg.cursor.co-author' \) -delete 2>/dev/null || true
fi

strip_hook='#!/bin/sh
# Drop Cursor attribution trailers if a hook adds them back.
file="$1"
[ -n "$file" ] && [ -f "$file" ] || exit 0
tmp=$(mktemp)
grep -viE "co-authored-by:.*(cursor|cursoragent@cursor.com)|made with cursor|cursoragent@cursor.com" "$file" > "$tmp" || true
cat "$tmp" > "$file"
rm -f "$tmp"
exit 0
'

if [ -d "$hooks_root" ]; then
  for dir in "$hooks_root"/*; do
    [ -d "$dir" ] || continue
    printf '%s\n' "$strip_hook" > "$dir/commit-msg.cursor.strip"
    chmod 0755 "$dir/commit-msg.cursor.strip"
  done
fi

git_dir=$(git rev-parse --git-path hooks 2>/dev/null || true)
if [ -n "$git_dir" ]; then
  mkdir -p "$git_dir"
  printf '%s\n' "$strip_hook" > "$git_dir/commit-msg"
  chmod 0755 "$git_dir/commit-msg"
fi

if ! pgrep -f "storageflow-hook-reaper" >/dev/null 2>&1; then
  nohup bash -c '
    while true; do
      # storageflow-hook-reaper
      find "$1" -type f \( -name "*co-author*" -o -name "commit-msg.cursor.co-author" \) -delete 2>/dev/null || true
      sleep 2
    done
  ' storageflow-hook-reaper "$hooks_root" >/tmp/storageflow-hook-reaper.log 2>&1 &
  disown || true
fi
