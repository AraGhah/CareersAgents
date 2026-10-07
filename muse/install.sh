#!/usr/bin/env bash
# Install the internship desk's bridge on a Muse gadget: a Raspberry Pi or other Linux box that already runs the Linux
# Device SDK (github.com/facebookincubator/muse-gadget-sdk, linux/install.sh) and is paired with the Muse app.
#
#   bash install.sh                    install or update; keeps the token and side chat of an earlier install
#   bash install.sh --user pi          the account the bridge runs as (default: the one that ran sudo, else you)
#   bash install.sh --port 8788        port the desk sends to
#   bash install.sh --main-chat        post to the main Muse chat instead of a side chat of its own
#   bash install.sh --new-token        make a new token (the desk's MUSE_BRIDGE_TOKEN must then change too)
#   bash install.sh --no-intro         don't post the hello message in the Muse chat
#   bash install.sh --uninstall        remove it (the musegadget service is not touched)
#
# Run it from this directory (copy muse/ from the desk's repo to the gadget). It asks for sudo.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MUSEGADGET="/opt/musegadget/venv/bin/musegadget"
ETC=/etc/desk-bridge
OPT=/opt/desk-bridge
STATE=/var/lib/desk-bridge
UNIT=/etc/systemd/system/desk-bridge.service

RUN_AS="${SUDO_USER:-$(id -un)}"
PORT=8788
MAIN_CHAT=0
NEW_TOKEN=0
INTRO=1
UNINSTALL=0

die() { echo "error: $*" >&2; exit 1; }
# Run a command as the bridge's account, from root or from a sudoer.
as_user() {
  if command -v sudo >/dev/null; then sudo -u "$RUN_AS" "$@"; else runuser -u "$RUN_AS" -- "$@"; fi
}
# Is the account in this group? (No pipe into grep -q: with pipefail, its early exit can fail the whole test.)
in_group() {
  case " $(id -nG "$RUN_AS") " in *" $1 "*) return 0 ;; *) return 1 ;; esac
}

while [ $# -gt 0 ]; do
  case "$1" in
    --user) RUN_AS="${2:?--user needs an account name}"; shift 2 ;;
    --port) PORT="${2:?--port needs a number}"; shift 2 ;;
    --main-chat) MAIN_CHAT=1; shift ;;
    --new-token) NEW_TOKEN=1; shift ;;
    --no-intro) INTRO=0; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
done

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  command -v sudo >/dev/null || die "run this as root, or install sudo"
  SUDO=sudo
fi

if [ "$UNINSTALL" -eq 1 ]; then
  $SUDO systemctl disable --now desk-bridge.service 2>/dev/null || true
  $SUDO rm -f "$UNIT" /usr/local/bin/desk-status
  $SUDO rm -rf "$OPT" "$ETC" "$STATE"
  $SUDO systemctl daemon-reload
  echo "Removed the desk bridge. Remove MUSE_BRIDGE_URL and MUSE_BRIDGE_TOKEN from the desk's .env.local too."
  exit 0
fi

[ -x "$MUSEGADGET" ] || die "musegadget is not installed: set up the Linux Device SDK first (muse-gadget-sdk/linux/install.sh)"
[ -x /usr/bin/python3 ] || die "python3 is missing"
/usr/bin/python3 -c 'import sys; sys.exit(sys.version_info < (3, 9))' || die "Python 3.9 or later is needed"
id "$RUN_AS" >/dev/null 2>&1 || die "no account named $RUN_AS"
case "$PORT" in ''|*[!0-9]*) die "--port must be a number" ;; esac
[ -f "$HERE/desk_bridge.py" ] || die "run this from the muse/ directory (desk_bridge.py not found)"

# The bridge reaches Muse through musegadget's local socket, which only root and the socket's group may use.
SOCK=/run/musegadget/musegadget.sock
if $SUDO test -S "$SOCK"; then
  SOCK_GROUP="$($SUDO stat -c %G "$SOCK")"
  if ! in_group "$SOCK_GROUP"; then
    echo "warning: $RUN_AS is not in $SOCK_GROUP, the group of $SOCK: messages will not reach Muse."
    echo "         Use --user with the account musegadget runs commands as (the one its installer gave Muse)."
  fi
else
  echo "warning: $SOCK is missing: is the musegadget service running? (sudo systemctl status musegadget)"
fi

if [ "$RUN_AS" = root ] || in_group sudo || in_group wheel; then
  echo "note: $RUN_AS can use sudo, so Muse can too. The desk only sends notifications, but an account without sudo"
  echo "      (musegadget's install.sh --run-as) is the safer home for a gadget that relays text from the web."
fi

echo "Installing the desk bridge for $RUN_AS on port $PORT…"
$SUDO install -d -m 0755 "$OPT"
$SUDO install -m 0755 "$HERE/desk_bridge.py" "$OPT/desk_bridge.py"
$SUDO install -d -m 0750 -o root -g "$(id -gn "$RUN_AS")" "$ETC"
$SUDO install -d -m 0750 -o "$RUN_AS" -g "$(id -gn "$RUN_AS")" "$STATE"

if [ "$NEW_TOKEN" -eq 1 ] || ! $SUDO test -s "$ETC/secret"; then
  /usr/bin/python3 -c 'import secrets; print(secrets.token_urlsafe(32))' | $SUDO tee "$ETC/secret" >/dev/null
fi
$SUDO chown root:"$(id -gn "$RUN_AS")" "$ETC/secret"
$SUDO chmod 0640 "$ETC/secret"

SESSION_ID=""
if [ "$MAIN_CHAT" -eq 0 ]; then
  if $SUDO test -s "$ETC/session_id"; then
    SESSION_ID="$($SUDO cat "$ETC/session_id")"
  else
    SESSION_ID="$(/usr/bin/python3 -c 'import uuid; print(uuid.uuid4())')"
    echo "$SESSION_ID" | $SUDO tee "$ETC/session_id" >/dev/null
  fi
fi

$SUDO tee "$ETC/env" >/dev/null <<EOF
DESK_BRIDGE_SECRET_FILE=$ETC/secret
DESK_BRIDGE_SESSION_ID=$SESSION_ID
DESK_BRIDGE_PORT=$PORT
DESK_BRIDGE_BIND=0.0.0.0
DESK_BRIDGE_STATE=$STATE/status.json
MUSEGADGET=$MUSEGADGET
EOF
$SUDO chmod 0640 "$ETC/env"
$SUDO chown root:"$(id -gn "$RUN_AS")" "$ETC/env"

# desk-status: what Muse runs (system.run) to read the desk.
$SUDO tee /usr/local/bin/desk-status >/dev/null <<EOF
#!/bin/sh
DESK_BRIDGE_STATE=$STATE/status.json exec /usr/bin/python3 $OPT/desk_bridge.py status "\$@"
EOF
$SUDO chmod 0755 /usr/local/bin/desk-status

sed "s/@USER@/$RUN_AS/" "$HERE/desk-bridge.service" | $SUDO tee "$UNIT" >/dev/null
$SUDO systemctl daemon-reload
$SUDO systemctl enable desk-bridge.service >/dev/null
$SUDO systemctl restart desk-bridge.service

sleep 1
if ! curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
  echo "warning: the bridge does not answer yet; see: sudo journalctl -u desk-bridge -n 30"
fi

if [ "$INTRO" -eq 1 ]; then
  ARGS=(send-user-msg)
  [ -n "$SESSION_ID" ] && ARGS+=(--session-id "$SESSION_ID")
  ARGS+=(-)
  if ! as_user "$MUSEGADGET" "${ARGS[@]}" >/dev/null 2>&1 <<'EOF'
Hi Muse, this chat is for my internship desk (the app on my PC that finds internships and fills careers forms). It will post here when the daily run finishes and when an employer replies. Whenever I ask about my internship desk, my applications, or what waits for my approval, run desk-status on this gadget and answer from it. Approving and submitting are done by me on the desk itself, never from here.
EOF
  then
    echo "warning: the hello message did not reach Muse (is the gadget paired? sudo musegadget info)"
  fi
fi

ADDR="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo
echo "Done. Put these two lines in the desk's .env.local, on the PC:"
echo
echo "  MUSE_BRIDGE_URL=http://${ADDR:-$(hostname)}:$PORT"
echo "  MUSE_BRIDGE_TOKEN=$($SUDO cat "$ETC/secret")"
echo
echo "Then, on the PC: npm run muse:send     (a test message, end to end)"
[ -n "$SESSION_ID" ] && echo "Messages go to the Muse side chat $SESSION_ID."
echo "Manage it: sudo systemctl status desk-bridge · sudo journalctl -u desk-bridge -f · desk-status"
