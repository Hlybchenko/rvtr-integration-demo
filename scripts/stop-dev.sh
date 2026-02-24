#!/usr/bin/env bash
set -euo pipefail

PORT="5173"

close_dev_tabs_macos() {
	if [[ "$(uname -s)" != "Darwin" ]]; then
		return
	fi

	if ! command -v osascript >/dev/null 2>&1; then
		return
	fi

	set +e
	local apps=(
		"Google Chrome"
		"Google Chrome for Testing"
		"Chromium"
		"Brave Browser"
		"Arc"
	)

	local script_status=0
	local script_output=""
	for app_name in "${apps[@]}"; do
		if ! pgrep -x "${app_name}" >/dev/null 2>&1; then
			continue
		fi

		script_output="$(/usr/bin/osascript \
			-e "tell application \"${app_name}\"" \
			-e 'if running then' \
			-e 'set wCount to count windows' \
			-e 'repeat with w from wCount to 1 by -1' \
			-e 'set tCount to count tabs of window w' \
			-e 'repeat with t from tCount to 1 by -1' \
			-e 'set u to URL of tab t of window w' \
			-e 'if u starts with "http://localhost:5173" then close tab t of window w' \
			-e 'if u starts with "https://localhost:5173" then close tab t of window w' \
			-e 'if u starts with "http://127.0.0.1:5173" then close tab t of window w' \
			-e 'if u starts with "https://127.0.0.1:5173" then close tab t of window w' \
			-e 'end repeat' \
			-e 'end repeat' \
			-e 'end if' \
			-e 'end tell' 2>&1)"
		status=$?
		if [[ $status -ne 0 ]]; then
			script_status=$status
			break
		fi
	done
	set -e

	if [[ $script_status -ne 0 ]]; then
		echo "Note: couldn't auto-close browser tab for localhost:5173 (${script_output})."
		echo "Tip: macOS may require Automation permission for Terminal -> Chrome in System Settings > Privacy & Security > Automation."
	fi
}

close_dev_tabs_macos

PIDS="$(lsof -ti "tcp:${PORT}" -sTCP:LISTEN || true)"
if [[ -n "$PIDS" ]]; then
	kill $PIDS >/dev/null 2>&1 || true
fi

WRITER_PIDS="$(lsof -ti "tcp:3210" -sTCP:LISTEN || true)"
if [[ -n "$WRITER_PIDS" ]]; then
	kill $WRITER_PIDS >/dev/null 2>&1 || true
fi

pkill -f 'dev-unsafe.mjs' >/dev/null 2>&1 || true
pkill -f 'agent-option-writer.mjs' >/dev/null 2>&1 || true

echo "Stopped local dev processes on ports ${PORT} and 3210 (if any were running)."
