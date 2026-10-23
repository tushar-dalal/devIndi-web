"""The radial drop wheel that appears under the cursor while dragging files."""
from __future__ import annotations

import math

from PySide6.QtCore import QEasingCurve, QPoint, QPointF, QRectF, Qt, QTimer, QVariantAnimation, Signal
from PySide6.QtGui import QColor, QFont, QGuiApplication, QPainter, QPainterPath, QPen, QRadialGradient
from PySide6.QtWidgets import QWidget

from . import converters as conv
from . import plat
from .theme import ACCENT, FONT, TEXT

# Segoe MDL2 Assets glyphs on Windows; widely available Unicode symbols elsewhere
TOOL_ICONS = {
    "compress": "", "metadata": "", "edit": "", "annotate": "",
    "addbg": "", "crop": "", "redact": "", "clean": "", "merge": "",
} if plat.IS_WIN else {
    "compress": "⇲", "metadata": "ⓘ", "edit": "✎", "annotate": "✍", "addbg": "▣",
    "crop": "✂", "redact": "◼", "clean": "⌫", "merge": "⧉",
}


class WheelWindow(QWidget):
    # paths, kind ("convert" | "tool"), value (target format or tool id)
    dropped = Signal(list, str, str)

    SIZE = 380
    R_OUT = 168
    R_IN = 64
    GAP_DEG = 5.0

    def __init__(self):
        super().__init__(None, Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.Tool
                         | Qt.WindowDoesNotAcceptFocus)
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.setAttribute(Qt.WA_ShowWithoutActivating)
        self.setAcceptDrops(True)
        self.setFixedSize(self.SIZE, self.SIZE)
        self.paths: list[str] = []
        self.pages: list[list[tuple[str, str, str]]] = [[], []]
        self.page = 0
        self.hover = -1
        self.did_drop = False
        # Probe: shown invisibly under the cursor; becomes visible only when files are dragged over it.
        self.probing = False
        self.leave_hides = False
        self._leave_timer = QTimer(self, singleShot=True, interval=700, timeout=self.hide)
        self._scale = 1.0
        self._anim = QVariantAnimation(self, duration=140, easingCurve=QEasingCurve.OutBack)
        self._anim.valueChanged.connect(self._on_anim)

    # ------------------------------------------------------------ public API
    def show_at(self, pos: QPoint, probe: bool = False, leave_hides: bool = False):
        self.paths, self.pages, self.page, self.hover, self.did_drop = [], [[], []], 0, -1, False
        self.probing, self.leave_hides = probe, leave_hides
        self._leave_timer.stop()
        screen = QGuiApplication.screenAt(pos) or QGuiApplication.primaryScreen()
        g = screen.availableGeometry()
        x = min(max(pos.x() - self.SIZE // 2, g.left()), g.right() - self.SIZE)
        y = min(max(pos.y() - self.SIZE // 2, g.top()), g.bottom() - self.SIZE)
        self.move(x, y)
        self._animate_in()
        self.show()
        self.raise_()

    def load_paths(self, paths: list[str]):
        if paths != self.paths:
            self.paths = paths
            self.pages = [
                [("convert", t, t) for t in conv.targets_for(paths)],
                [("tool", t, conv.TOOL_LABELS[t]) for t in conv.tools_for(paths)],
            ]
            if not self.pages[self.page] and self.pages[1 - self.page]:
                self.page = 1 - self.page
        self.update()

    def toggle_page(self):
        other = 1 - self.page
        if not self.paths or self.pages[other]:
            self.page = other
            self.hover = -1
            self._animate_in()
            self.update()

    # ------------------------------------------------------------ animation
    def _animate_in(self):
        self._anim.stop()
        self._anim.setStartValue(0.82)
        self._anim.setEndValue(1.0)
        self._anim.start()

    def _on_anim(self, v):
        self._scale = float(v)
        self.update()

    # ------------------------------------------------------------ geometry
    def _items(self):
        return self.pages[self.page]

    def _center(self) -> QPointF:
        return QPointF(self.SIZE / 2, self.SIZE / 2)

    def _index_at(self, p: QPointF) -> int:
        items = self._items()
        if not items:
            return -1
        c = self._center()
        dx, dy = p.x() - c.x(), p.y() - c.y()
        r = math.hypot(dx, dy)
        if r < self.R_IN or r > self.R_OUT + 6:
            return -1
        ang = (math.degrees(math.atan2(dy, dx)) + 90) % 360  # 0 = top, clockwise
        span = 360 / len(items)
        return int(((ang + span / 2) % 360) // span)

    # ------------------------------------------------------------ painting
    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        p.setRenderHint(QPainter.TextAntialiasing)
        c = self._center()
        p.translate(c)
        if self.probing:
            # Alpha 1 is invisible but still counts as "window here" for drag-and-drop hit testing.
            p.setPen(Qt.NoPen)
            p.setBrush(QColor(255, 255, 255, 1))
            p.drawEllipse(QPointF(0, 0), self.R_OUT + 9, self.R_OUT + 9)
            return
        p.scale(self._scale, self._scale)

        # Frosted backing disc
        grad = QRadialGradient(QPointF(0, 0), self.R_OUT + 10)
        grad.setColorAt(0.0, QColor(255, 245, 236, 235))
        grad.setColorAt(1.0, QColor(255, 226, 205, 215))
        p.setPen(QPen(QColor(255, 255, 255, 200), 2))
        p.setBrush(grad)
        p.drawEllipse(QPointF(0, 0), self.R_OUT + 9, self.R_OUT + 9)

        items = self._items()
        n = max(len(items), 1)
        span = 360 / n
        for i in range(n):
            mid = i * span  # degrees clockwise from top
            path = self._sector(mid - span / 2 + self.GAP_DEG / 2, span - self.GAP_DEG)
            hovered = i == self.hover and items
            fill = ACCENT if hovered else QColor(255, 216, 192, 240)
            p.setPen(QPen(fill, 5, Qt.SolidLine, Qt.RoundCap, Qt.RoundJoin))
            p.setBrush(fill)
            p.drawPath(path)
            if not items:
                continue
            kind, value, label = items[i]
            rad = math.radians(mid - 90)
            rm = (self.R_IN + self.R_OUT) / 2 + 6
            tx, ty = rm * math.cos(rad), rm * math.sin(rad)
            color = QColor("white") if hovered else TEXT
            p.setPen(color)
            if kind == "tool":
                p.setFont(QFont(plat.ICON_FONT, 15) if plat.ICON_FONT else QFont(FONT, 15))
                p.drawText(QRectF(tx - 30, ty - 24, 60, 22), Qt.AlignHCenter | Qt.AlignBottom,
                           TOOL_ICONS.get(value, ""))
                f = QFont(FONT, 8)
                f.setBold(True)
                p.setFont(f)
                p.drawText(QRectF(tx - 40, ty + 1, 80, 18), Qt.AlignHCenter | Qt.AlignTop, label.upper())
            else:
                f = QFont(FONT, 10)
                f.setBold(True)
                p.setFont(f)
                p.drawText(QRectF(tx - 40, ty - 12, 80, 24), Qt.AlignCenter, label)

        # Centre hub
        p.setPen(QPen(QColor(255, 255, 255, 220), 2))
        p.setBrush(QColor(255, 240, 230, 245))
        p.drawEllipse(QPointF(0, 0), self.R_IN - 8, self.R_IN - 8)
        p.setPen(TEXT)
        f = QFont(FONT, 10)
        f.setBold(True)
        p.setFont(f)
        if not self.paths:
            title, sub = "Drop", "move to load"
        elif not any(self.pages):
            title, sub = "Unsupported", "file type"
        else:
            title = items[self.hover][2] if 0 <= self.hover < len(items) else \
                ("Convert" if self.page == 0 else "Tools")
            other = self.pages[1 - self.page]
            sub = ("Shift → " + ("Tools" if self.page == 0 else "Convert")) if other else \
                f"{len(self.paths)} file{'s' if len(self.paths) > 1 else ''}"
        p.drawText(QRectF(-50, -20, 100, 22), Qt.AlignCenter, title)
        p.setFont(QFont(FONT, 8))
        p.setPen(QColor(138, 90, 68))
        p.drawText(QRectF(-50, 2, 100, 18), Qt.AlignCenter, sub)

    def _sector(self, start_deg: float, extent_deg: float) -> QPainterPath:
        """Annular sector; angles are degrees clockwise from 12 o'clock."""
        ro, ri = self.R_OUT - 3, self.R_IN + 3
        # Qt angles: 0 = 3 o'clock, counter-clockwise positive
        qt_start = 90 - start_deg
        path = QPainterPath()
        outer = QRectF(-ro, -ro, 2 * ro, 2 * ro)
        inner = QRectF(-ri, -ri, 2 * ri, 2 * ri)
        path.arcMoveTo(outer, qt_start)
        path.arcTo(outer, qt_start, -extent_deg)
        path.arcTo(inner, qt_start - extent_deg, extent_deg)
        path.closeSubpath()
        return path

    # ------------------------------------------------------------ drag & drop
    def _local_paths(self, mime) -> list[str]:
        if not mime.hasUrls():
            return []
        return [u.toLocalFile() for u in mime.urls() if u.isLocalFile() and u.toLocalFile()]

    def dragEnterEvent(self, e):
        paths = self._local_paths(e.mimeData())
        if not paths:
            e.ignore()
            return
        self._leave_timer.stop()
        if self.probing:
            self.probing = False
            self._animate_in()
        self.load_paths(paths)
        e.setDropAction(Qt.CopyAction)
        e.accept()

    def dragMoveEvent(self, e):
        idx = self._index_at(self._unscale(e.position()))
        if idx != self.hover:
            self.hover = idx
            self.update()
        if idx >= 0:
            e.setDropAction(Qt.CopyAction)
            e.accept()
        else:
            e.ignore()

    def dragLeaveEvent(self, _):
        self.hover = -1
        self.update()
        if self.leave_hides:  # opened from the dock, where nothing else watches the mouse button
            self._leave_timer.start()

    def dropEvent(self, e):
        idx = self._index_at(self._unscale(e.position()))
        items = self._items()
        if idx < 0 or not items:
            e.ignore()
            return
        # Always report COPY so Explorer never deletes the source (Shift normally means "move").
        e.setDropAction(Qt.CopyAction)
        e.accept()
        self.did_drop = True
        kind, value, _ = items[idx]
        paths = list(self.paths)
        self.hide()
        # Return from the drop first so Explorer's drag loop is released before we do work.
        QTimer.singleShot(0, lambda: self.dropped.emit(paths, kind, value))

    def _unscale(self, pos) -> QPointF:
        c = self._center()
        return QPointF(c.x() + (pos.x() - c.x()) / self._scale, c.y() + (pos.y() - c.y()) / self._scale)
