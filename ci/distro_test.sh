#!/usr/bin/env bash
# Run inside a fresh distro container: start the AppImage on a virtual display and confirm it launches.
# usage: distro_test.sh <AppImage>
set -uo pipefail
APP="$1"
cd /tmp
cp "/w/$APP" ./app.AppImage
chmod +x app.AppImage
./app.AppImage --appimage-extract > /dev/null
echo "--- libraries the X11 platform plugin can't find (should be empty):"
find squashfs-root -name 'libqxcb.so' -exec ldd {} \; | grep "not found" || echo "(none)"
Xvfb :99 -screen 0 1280x800x24 > /dev/null 2>&1 &
sleep 2
DISPLAY=:99 XDG_SESSION_TYPE=x11 timeout 60 squashfs-root/AppRun --smoketest
code=$?
LOG="$HOME/.local/state/ShiftDrop/shiftdrop.log"
cat "$LOG" 2>/dev/null | tail -5
if [ $code -eq 0 ] && grep -q "smoketest ok" "$LOG"; then
  echo "DISTRO PASS"
else
  echo "DISTRO FAIL (exit $code)"
  exit 1
fi
