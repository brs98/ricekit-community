#!/bin/sh
# Start or reload SketchyBar and prove that its IPC server responds.

set -u

resolve_sketchybar() {
  if [ -n "${RICEKIT_SKETCHYBAR_BIN:-}" ]; then
    if [ -x "$RICEKIT_SKETCHYBAR_BIN" ]; then
      printf '%s\n' "$RICEKIT_SKETCHYBAR_BIN"
      return 0
    fi
    return 1
  fi

  for candidate in /opt/homebrew/bin/sketchybar /usr/local/bin/sketchybar; do
    if [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  command -v sketchybar 2>/dev/null || return 1
}

run_bounded() {
  timeout_file="$(mktemp "${TMPDIR:-/tmp}/ricekit-command-timeout.XXXXXX")" || return 1
  rm -f "$timeout_file"
  "$@" &
  command_pid=$!
  (
    sleep 0.5
    : >"$timeout_file"
    kill -TERM "$command_pid" 2>/dev/null || exit 0
    sleep 0.2
    kill -KILL "$command_pid" 2>/dev/null || true
  ) &
  watchdog_pid=$!

  wait "$command_pid"
  command_status=$?
  kill "$watchdog_pid" 2>/dev/null || true
  wait "$watchdog_pid" 2>/dev/null || true
  if [ -e "$timeout_file" ]; then
    rm -f "$timeout_file"
    return 124
  fi
  rm -f "$timeout_file"
  return "$command_status"
}

probe_dir="$(mktemp -d "${TMPDIR:-/tmp}/ricekit-sketchybar.XXXXXX")" || {
  echo "RiceKit: could not create a temporary directory for SketchyBar readiness checks." >&2
  exit 1
}
trap 'rm -rf "$probe_dir"' EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

SKETCHYBAR_BIN="$(resolve_sketchybar)" || {
  echo "RiceKit: SketchyBar is unavailable. Install it with: brew install FelixKratz/formulae/sketchybar" >&2
  exit 127
}

same_user_process_exists() {
  pgrep -U "$(id -u)" -x sketchybar >/dev/null 2>&1
}

query_responds() {
  query_target=$1
  response_file="$probe_dir/query-$query_target.json"

  same_user_process_exists || return 1
  if ! run_bounded "$SKETCHYBAR_BIN" --query "$query_target" >"$response_file" 2>/dev/null; then
    return 1
  fi
  LC_ALL=C grep -Eq '^[[:space:]]*\{' "$response_file"
}

ricekit_starter_installed() {
  starter_path="$HOME/.config/sketchybar/sketchybarrc"
  [ -f "$starter_path" ] && grep -Fq -- '--add item ricekit.brand left' "$starter_path"
}

runtime_responds() {
  query_responds bar || return 1
  if ricekit_starter_installed; then
    query_responds ricekit.brand
  fi
}

reload_config() {
  default_config="$HOME/.config/sketchybar/sketchybarrc"
  if ricekit_starter_installed; then
    run_bounded "$SKETCHYBAR_BIN" --reload "$default_config"
  else
    run_bounded "$SKETCHYBAR_BIN" --reload
  fi
}

started_pid=""
if query_responds bar; then
  if ! reload_config >/dev/null 2>&1; then
    echo "RiceKit: SketchyBar is running, but its configuration reload failed." >&2
    exit 1
  fi
elif same_user_process_exists; then
  echo "RiceKit: a SketchyBar process exists but its bar is not responding. Stop it and apply the Rice again." >&2
  exit 1
else
  log_dir="$HOME/Library/Logs"
  mkdir -p "$log_dir"
  nohup "$SKETCHYBAR_BIN" >"$log_dir/RiceKit-sketchybar.log" 2>&1 &
  started_pid=$!
fi

attempt=0
while [ "$attempt" -lt 5 ]; do
  if runtime_responds; then
    exit 0
  fi
  if [ -n "$started_pid" ] && ! kill -0 "$started_pid" 2>/dev/null; then
    wait "$started_pid"
    start_status=$?
    echo "RiceKit: SketchyBar exited before its bar became queryable (status $start_status). See ~/Library/Logs/RiceKit-sketchybar.log." >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep 0.1
done

if [ -n "$started_pid" ]; then
  kill "$started_pid" 2>/dev/null || true
fi
echo "RiceKit: SketchyBar did not become queryable within the verification window. See ~/Library/Logs/RiceKit-sketchybar.log." >&2
exit 1
