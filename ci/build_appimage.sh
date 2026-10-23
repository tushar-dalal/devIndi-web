#!/usr/bin/env bash
# Package dist/ShiftDrop (PyInstaller folder) as an AppImage and a .tar.gz.
set -euo pipefail
VERSION="${1:-1.1.0}"
ARCH=x86_64

rm -rf AppDir
mkdir -p AppDir/usr/lib
cp -r dist/ShiftDrop AppDir/usr/lib/shiftdrop
cp assets/icon.png AppDir/shiftdrop.png
cat > AppDir/shiftdrop.desktop <<'EOF'
[Desktop Entry]
Type=Application
Name=ShiftDrop
Comment=Drag files, press Shift, drop to convert
Exec=ShiftDrop
Icon=shiftdrop
Terminal=false
Categories=Utility;Graphics;Office;
EOF
cat > AppDir/AppRun <<'EOF'
#!/bin/sh
HERE="$(dirname "$(readlink -f "$0")")"
exec "$HERE/usr/lib/shiftdrop/ShiftDrop" "$@"
EOF
chmod +x AppDir/AppRun

if [ ! -x appimagetool ]; then
  curl -fsSL -o appimagetool \
    https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage
  chmod +x appimagetool
fi
APPIMAGE_EXTRACT_AND_RUN=1 ARCH=$ARCH ./appimagetool AppDir "ShiftDrop-${VERSION}-${ARCH}.AppImage"
tar -C dist -czf "ShiftDrop-${VERSION}-linux-${ARCH}.tar.gz" ShiftDrop
ls -la ShiftDrop-*
