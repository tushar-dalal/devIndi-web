"""End-to-end test of the real Shift gesture on X11 (run under Xvfb with xdotool installed).

1. starts the packaged ShiftDrop
2. starts a tiny Qt window that drags a JPG like a file manager would
3. drives the real mouse/keyboard with xdotool: press, move, press Shift, move onto the
   wheel's top slice (PNG), release
4. checks that the PNG was written next to the JPG

usage: python e2e_x11.py <path-to-ShiftDrop-binary> <work-dir> <screenshot.png>
"""
import os
import subprocess
import sys
import textwrap
import time
from pathlib import Path

binary, work, shot = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
work.mkdir(parents=True, exist_ok=True)
jpg = work / "e2e.jpg"
from PIL import Image  # noqa: E402

Image.new("RGB", (400, 300), (40, 120, 200)).save(jpg)

source = work / "drag_source.py"
source.write_text(textwrap.dedent(f"""
    import sys
    from PySide6.QtCore import QMimeData, Qt, QUrl
    from PySide6.QtGui import QDrag
    from PySide6.QtWidgets import QApplication, QLabel

    class Src(QLabel):
        def mousePressEvent(self, e):
            self.start = e.position()
        def mouseMoveEvent(self, e):
            if (e.position() - self.start).manhattanLength() < 8:
                return
            m = QMimeData()
            m.setUrls([QUrl.fromLocalFile({str(jpg)!r})])
            d = QDrag(self)
            d.setMimeData(m)
            print("drag result", d.exec(Qt.CopyAction | Qt.MoveAction), flush=True)

    app = QApplication(sys.argv)
    w = Src("drag me")
    w.setWindowFlag(Qt.FramelessWindowHint)
    w.setGeometry(40, 40, 260, 260)
    w.show()
    app.exec()
"""))

env = dict(os.environ, QT_QPA_PLATFORM="xcb")
env.pop("WAYLAND_DISPLAY", None)
env["XDG_SESSION_TYPE"] = "x11"
app = subprocess.Popen([str(binary), "--quiet"], env=env)
src = subprocess.Popen([sys.executable, str(source)], env=env)
time.sleep(6)


def xdo(*args):
    subprocess.run(["xdotool", *map(str, args)], check=True)
    time.sleep(0.15)


ok = False
try:
    xdo("mousemove", 150, 150)
    xdo("mousedown", 1)
    for step in range(1, 9):  # start the drag
        xdo("mousemove", 150 + step * 10, 150 + step * 10)
    xdo("keydown", "shift")  # the gesture
    time.sleep(0.4)
    xdo("mousemove", 236, 236)  # nudge so the drop target sees the drag enter
    xdo("mousemove", 232, 232)
    time.sleep(0.4)
    # The wheel is centred where Shift was pressed (230,230); its top slice is ~115 px above.
    for y in range(220, 110, -12):
        xdo("mousemove", 232, y)
    time.sleep(0.5)
    subprocess.run(["import", "-window", "root", str(shot)], check=False)
    xdo("mouseup", 1)
    xdo("keyup", "shift")
    for _ in range(30):
        if (work / "e2e.png").exists():
            ok = True
            break
        time.sleep(0.5)
finally:
    src.terminate()
    app.terminate()

print("E2E", "PASS: e2e.png written by the wheel" if ok else "FAIL: no e2e.png", sorted(p.name for p in work.iterdir()))
sys.exit(0 if ok else 1)
