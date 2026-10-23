"""A small always-on-top drop target at the screen edge.

Used where the Shift gesture can't work (Linux on Wayland) and optionally everywhere:
drag files onto the dock and the wheel opens under the cursor.
"""
from __future__ import annotations

from PySide6.QtCore import QPointF, QRectF, Qt, Signal
from PySide6.QtGui import QColor, QFont, QGuiApplication, QPainter, QPen
from PySide6.QtWidgets import QWidget

from .theme import ACCENT, font


class DockWindow(QWidget):
    files_entered = Signal(object)  # global QPoint where the drag entered

    W, H = 34, 132

    def __init__(self):
        super().__init__(None, Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.Tool
                         | Qt.WindowDoesNotAcceptFocus)
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.setAttribute(Qt.WA_ShowWithoutActivating)
        self.setAcceptDrops(True)
        self.setFixedSize(self.W, self.H)
        self.setToolTip("ShiftDrop — drag files here")
        self.hot = False

    def place(self):
        g = (QGuiApplication.primaryScreen()).availableGeometry()
        self.move(g.right() - self.W + 1, g.top() + (g.height() - self.H) // 2)

    def showEvent(self, e):
        self.place()
        super().showEvent(e)

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        r = QRectF(3, 2, self.W + 12, self.H - 4)  # rounded on the left, runs off the right edge
        p.setPen(QPen(QColor(255, 255, 255, 200), 1.5))
        p.setBrush(ACCENT if self.hot else QColor(255, 232, 216, 235))
        p.drawRoundedRect(r, 14, 14)
        p.setPen(QColor("white") if self.hot else ACCENT)
        p.setBrush(Qt.NoBrush)
        c = QPointF(self.W / 2 + 2, 26)
        p.drawEllipse(c, 9, 9)
        p.drawEllipse(c, 3, 3)
        p.save()
        p.translate(self.W / 2 + 7, self.H - 14)
        p.rotate(-90)
        f = font(8, bold=True)
        p.setFont(f)
        p.drawText(QRectF(0, -14, 80, 16), Qt.AlignLeft | Qt.AlignVCenter, "DROP HERE")
        p.restore()

    def dragEnterEvent(self, e):
        if not e.mimeData().hasUrls():
            e.ignore()
            return
        self.hot = True
        self.update()
        e.acceptProposedAction()
        self.files_entered.emit(self.mapToGlobal(e.position().toPoint()))

    def dragLeaveEvent(self, _):
        self.hot = False
        self.update()

    def dropEvent(self, e):
        # The wheel normally covers the dock before a drop lands here; ignore stray drops.
        self.hot = False
        self.update()
        e.ignore()
