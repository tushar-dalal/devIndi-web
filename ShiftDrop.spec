# PyInstaller spec for ShiftDrop on Windows, macOS and Linux.
#   python -m PyInstaller --noconfirm ShiftDrop.spec
# Windows -> dist/ShiftDrop.exe (one file)   macOS -> dist/ShiftDrop.app   Linux -> dist/ShiftDrop/ (folder)
import sys

from PyInstaller.utils.hooks import collect_all, collect_data_files, collect_submodules

IS_WIN = sys.platform == "win32"
IS_MAC = sys.platform == "darwin"
VERSION = "1.1.0"

datas, binaries, hiddenimports = [], [], []
d, b, h = collect_all("pillow_heif")
datas += d; binaries += b; hiddenimports += h
datas += collect_data_files("pymupdf") + collect_data_files("docx")
hiddenimports += collect_submodules("pymupdf") + collect_submodules("pdf2docx")

excludes = ["tkinter", "matplotlib", "IPython", "PySide6.QtQml", "PySide6.QtQuick", "PySide6.QtWebEngineCore",
            "PySide6.Qt3DCore", "PySide6.QtMultimedia", "PySide6.QtPdf"]
if IS_WIN:
    excludes += ["PySide6.QtNetwork", "PySide6.QtOpenGL", "PySide6.QtSvg"]

a = Analysis(["ShiftDrop.pyw"], binaries=binaries, datas=datas, hiddenimports=hiddenimports, excludes=excludes)

# Libraries the app never touches: OpenCV's video codecs, Qt's software OpenGL, Qt Quick/QML/PDF,
# and Qt translations. Windows (fully tested) drops a few more Qt modules.
DROP = ["opencv_videoio_ffmpeg", "opengl32sw", "qt6quick", "qtquick", "qt6qml", "qtqml", "qt6pdf", "qtpdf",
        "qt6virtualkeyboard", "qtvirtualkeyboard"]
if IS_WIN:
    DROP += ["qt6network", "qt6opengl", "qt6svg", "qt6dbus"]


def keep(entry):
    name = entry[0].replace("\\", "/").lower()
    parts = name.split("/")
    base = parts[-1]
    if any(base.startswith(p) or base.startswith("lib" + p) for p in DROP):
        return False
    if any(p.endswith(".framework") and p[:-10] in DROP for p in parts):  # macOS Qt frameworks
        return False
    if "/translations/" in name or name.endswith(".qm"):
        return False
    return True


a.binaries = [e for e in a.binaries if keep(e)]
a.datas = [e for e in a.datas if keep(e)]

pyz = PYZ(a.pure)

if IS_WIN:
    exe = EXE(pyz, a.scripts, a.binaries, a.datas, [], name="ShiftDrop", icon="assets/ShiftDrop.ico",
              version="assets/version.txt", console=False, upx=False)
else:
    exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="ShiftDrop", console=False, upx=False,
              icon="assets/icon.png" if IS_MAC else None)
    coll = COLLECT(exe, a.binaries, a.datas, name="ShiftDrop", upx=False)
    if IS_MAC:
        app = BUNDLE(
            coll,
            name="ShiftDrop.app",
            icon="assets/icon.png",
            bundle_identifier="in.devindi.shiftdrop",
            version=VERSION,
            info_plist={
                "CFBundleName": "ShiftDrop",
                "CFBundleDisplayName": "ShiftDrop",
                "CFBundleShortVersionString": VERSION,
                "CFBundleVersion": VERSION,
                "LSUIElement": True,  # menu-bar app: no Dock icon
                "LSMinimumSystemVersion": "12.0",
                "NSHighResolutionCapable": True,
                "NSHumanReadableCopyright": "© 2026 devIndi · AGPL-3.0",
            },
        )
