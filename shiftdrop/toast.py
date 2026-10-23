"""Small progress toast shown while files are converted ("Converting to JPG — 1 of 1 saved")."""
from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import QPoint, QRectF, Qt, QTimer
from PySide6.QtGui import QColor, QFont, QGuiApplication, QPainter, QPen
from PySide6.QtWidgets import QWidget

from . import plat
from .theme import ACCENT, TEXT, font


class Toast(QWidget):
    W, H = 300, 84

    def __init__(self):
        super().__init__(None, Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.Tool
                         | Qt.WindowDoesNotAcceptFocus)
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.setAttribute(Qt.WA_ShowWithoutActivating)
        self.setFixedSize(self.W, self.H)
        self.setCursor(Qt.PointingHandCursor)
        self.title = ""
        self.sub = ""
        self.total = 1
        self.done = 0
        self.error = False
        self.last_output: Path | None = None
        self._hide_timer = QTimer(self, singleShot=True, timeout=self.hide)

    def start(self, title: str, total: int, near: QPoint):
        self.title, self.total, self.done, self.error, self.last_output = title, max(total, 1), 0, False, None
        self.sub = f"0 of {self.total} saved"
        screen = QGuiApplication.screenAt(near) or QGuiApplication.primaryScreen()
        g = screen.availableGeometry()
        x = min(max(near.x() + 24, g.left() + 8), g.right() - self.W - 8)
        y = min(max(near.y() - self.H // 2, g.top() + 8), g.bottom() - self.H - 8)
        self.move(x, y)
        self._hide_timer.stop()
        self.show()
        self.raise_()
        self.update()

    def progress(self, done: int, output: str | None):
        self.done = done
        if output:
            self.last_output = Path(output)
        self.sub = f"{done} of {self.total} saved"
        self.update()

    def finish(self, message: str | None = None):
        if message:
            self.sub = message
        self.title = self.title.replace("Converting", "Converted").replace("…", "")
        self.update()
        self._hide_timer.start(4500)

    def fail(self, message: str):
        self.error = True
        self.title = "Something went wrong"
        self.sub = message[:90]
        self.update()
        self._hide_timer.start(8000)

    def mousePressEvent(self, e):
        if e.position().x() < 34 and e.position().y() < 40:
            self.hide()
            return
        if self.last_output and self.last_output.exists():
            plat.reveal(self.last_output)
        self.hide()

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        r = QRectF(4, 4, self.W - 8, self.H - 8)
        p.setPen(QPen(QColor(255, 255, 255, 200), 1.5))
        p.setBrush(QColor(255, 241, 232, 245))
        p.drawRoundedRect(r, 14, 14)
        # close "x"
        p.setPen(QPen(QColor(150, 110, 90), 1.6))
        p.drawLine(18, 20, 26, 28)
        p.drawLine(26, 20, 18, 28)
        f = font(10, bold=True)
        p.setFont(f)
        p.setPen(QColor("#b3261e") if self.error else TEXT)
        p.drawText(QRectF(36, 12, self.W - 50, 22), Qt.AlignVCenter | Qt.AlignLeft, self.title)
        p.setFont(font(9))
        p.setPen(QColor(140, 100, 82))
        p.drawText(QRectF(18, 38, self.W - 36, 18), Qt.AlignVCenter | Qt.AlignLeft, self.sub)
        # progress bar
        bar = QRectF(18, 62, self.W - 36, 5)
        p.setPen(Qt.NoPen)
        p.setBrush(QColor(240, 210, 195))
        p.drawRoundedRect(bar, 2.5, 2.5)
        frac = 1.0 if self.error else self.done / self.total
        if frac > 0:
            p.setBrush(QColor("#b3261e") if self.error else ACCENT)
            p.drawRoundedRect(QRectF(bar.x(), bar.y(), bar.width() * frac, bar.height()), 2.5, 2.5)
