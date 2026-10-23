"""Editor windows opened from the Tools ring: Crop, Add BG, Annotate, Redact, Edit, Metadata."""
from __future__ import annotations

import math
from pathlib import Path
from typing import Callable

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageOps
from PySide6.QtCore import QPointF, QRectF, Qt, QTimer, Signal
from PySide6.QtGui import (QColor, QFont, QImage, QPainter, QPainterPath, QPen, QPixmap, QPolygonF)
from PySide6.QtWidgets import (QApplication, QButtonGroup, QColorDialog, QFileDialog, QGridLayout,
                               QHBoxLayout, QHeaderView, QInputDialog, QLabel, QPushButton,
                               QSizePolicy, QSlider, QSpinBox, QTableWidget, QTableWidgetItem,
                               QVBoxLayout, QWidget)

from . import converters as conv
from .theme import ACCENT, FONT, STYLESHEET, pil_to_pixmap, pil_to_qimage, qimage_to_pil

Notify = Callable[[str, Path], None]


# ====================================================================== base

class BaseEditor(QWidget):
    def __init__(self, src: str, title: str, notify: Notify):
        super().__init__(None, Qt.Window)
        self.setObjectName("Editor")
        self.setAttribute(Qt.WA_DeleteOnClose)
        self.setAttribute(Qt.WA_StyledBackground)
        self.setStyleSheet(STYLESHEET)
        self.setWindowTitle(f"{title} — {Path(src).name}")
        self.src = src
        self.notify = notify
        self.layout_ = QVBoxLayout(self)
        self.layout_.setContentsMargins(16, 12, 16, 14)
        self.layout_.setSpacing(10)
        head = QLabel(title)
        head.setObjectName("Title")
        head.setAlignment(Qt.AlignCenter)
        self.layout_.addWidget(head)

    def save_image(self, img: Image.Image, label: str, force_png: bool = False) -> Path:
        src_label = conv.EXT_TO_LABEL.get(Path(self.src).suffix.lower(), "PNG")
        if force_png or src_label not in conv.IMAGE_FORMATS:
            src_label = "PNG"
        out = conv.derived_path(self.src, label, conv.IMAGE_FORMATS[src_label][0])
        conv.save_image(img, out, src_label, quality=95)
        self.notify(f"Saved {label.lower()} copy", out)
        return out

    @staticmethod
    def section(text: str) -> QLabel:
        l = QLabel(text)
        l.setObjectName("Section")
        return l

    @staticmethod
    def slider(lo: int, hi: int, val: int, on_change) -> QSlider:
        s = QSlider(Qt.Horizontal)
        s.setRange(lo, hi)
        s.setValue(val)
        s.valueChanged.connect(on_change)
        return s

    @staticmethod
    def seg_buttons(labels: list[str], on_pick, checked: int = 0) -> tuple[QHBoxLayout, QButtonGroup]:
        row = QHBoxLayout()
        row.setSpacing(4)
        group = QButtonGroup(row)
        group.setExclusive(True)
        for i, lab in enumerate(labels):
            b = QPushButton(lab)
            b.setCheckable(True)
            b.setChecked(i == checked)
            b.setCursor(Qt.PointingHandCursor)
            group.addButton(b, i)
            row.addWidget(b)
        group.idClicked.connect(on_pick)
        return row, group


def fit_preview(img: Image.Image, max_side: int = 900) -> tuple[Image.Image, float]:
    s = min(1.0, max_side / max(img.size))
    if s < 1.0:
        img = img.resize((max(1, int(img.width * s)), max(1, int(img.height * s))), Image.LANCZOS)
    return img, s


class ImageView(QWidget):
    """Widget that draws an image fitted inside itself and maps between view/image coords."""

    def __init__(self, qimg: QImage):
        super().__init__()
        self.qimg = qimg
        self.pix = QPixmap.fromImage(qimg)
        self.setMinimumSize(420, 320)
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        screen = QApplication.primaryScreen().availableGeometry()
        w, h = qimg.width(), qimg.height()
        s = min(1.0, (screen.width() * 0.55) / w, (screen.height() * 0.55) / h)
        self._pref = (int(w * s), int(h * s))

    def sizeHint(self):
        from PySide6.QtCore import QSize
        return QSize(max(420, self._pref[0]), max(320, self._pref[1]))

    def img_rect(self) -> QRectF:
        w, h = self.qimg.width(), self.qimg.height()
        s = min((self.width() - 20) / w, (self.height() - 20) / h)
        return QRectF((self.width() - w * s) / 2, (self.height() - h * s) / 2, w * s, h * s)

    def scale(self) -> float:
        return self.img_rect().width() / self.qimg.width()

    def to_img(self, p: QPointF) -> QPointF:
        r, s = self.img_rect(), self.scale()
        return QPointF((p.x() - r.x()) / s, (p.y() - r.y()) / s)

    def to_view(self, p: QPointF) -> QPointF:
        r, s = self.img_rect(), self.scale()
        return QPointF(r.x() + p.x() * s, r.y() + p.y() * s)

    def view_rect(self, rect: QRectF) -> QRectF:
        a, b = self.to_view(rect.topLeft()), self.to_view(rect.bottomRight())
        return QRectF(a, b)


# ====================================================================== crop

class CropCanvas(ImageView):
    changed = Signal()
    HANDLES = ("tl", "t", "tr", "r", "br", "b", "bl", "l")

    def __init__(self, qimg: QImage):
        super().__init__(qimg)
        self.W, self.H = qimg.width(), qimg.height()
        self.crop = QRectF(0, 0, self.W, self.H)
        self.ratio: float | None = None
        self.mode = None
        self.anchor = QPointF()
        self.press_img = QPointF()
        self.press_crop = QRectF()
        self.setMouseTracking(True)

    def reset(self):
        self.crop = QRectF(0, 0, self.W, self.H)
        if self.ratio:
            self.set_ratio(self.ratio)
        self.changed.emit()
        self.update()

    def set_ratio(self, r: float | None):
        self.ratio = r
        if r:
            w, h = self.W, self.W / r
            if h > self.H:
                h, w = self.H, self.H * r
            self.crop = QRectF((self.W - w) / 2, (self.H - h) / 2, w, h)
        self.changed.emit()
        self.update()

    def set_size(self, w: float, h: float):
        c = self.crop.center()
        w, h = min(max(w, 1), self.W), min(max(h, 1), self.H)
        r = QRectF(c.x() - w / 2, c.y() - h / 2, w, h)
        self.crop = self._clamp_move(r)
        self.update()

    def _clamp_move(self, r: QRectF) -> QRectF:
        x = min(max(r.x(), 0), self.W - r.width())
        y = min(max(r.y(), 0), self.H - r.height())
        return QRectF(x, y, r.width(), r.height())

    def _handle_points(self) -> dict[str, QPointF]:
        v = self.view_rect(self.crop)
        cx, cy = v.center().x(), v.center().y()
        return {"tl": v.topLeft(), "t": QPointF(cx, v.top()), "tr": v.topRight(),
                "r": QPointF(v.right(), cy), "br": v.bottomRight(), "b": QPointF(cx, v.bottom()),
                "bl": v.bottomLeft(), "l": QPointF(v.left(), cy)}

    def _hit(self, pos: QPointF):
        for name, pt in self._handle_points().items():
            if abs(pt.x() - pos.x()) <= 10 and abs(pt.y() - pos.y()) <= 10:
                return name
        if self.view_rect(self.crop).contains(pos):
            return "move"
        return "new"

    def mousePressEvent(self, e):
        pos = e.position()
        self.mode = self._hit(pos)
        p = self._clamp_pt(self.to_img(pos))
        self.press_img, self.press_crop = p, QRectF(self.crop)
        c = self.crop
        anchors = {"tl": c.bottomRight(), "tr": c.bottomLeft(), "br": c.topLeft(), "bl": c.topRight()}
        if self.mode in anchors:
            self.anchor = anchors[self.mode]
        elif self.mode == "new":
            self.anchor = p
        elif self.ratio and self.mode in ("r", "b"):
            self.anchor, self.mode = c.topLeft(), "corner"
        elif self.ratio and self.mode in ("l", "t"):
            self.anchor, self.mode = c.bottomRight(), "corner"

    def _clamp_pt(self, p: QPointF) -> QPointF:
        return QPointF(min(max(p.x(), 0), self.W), min(max(p.y(), 0), self.H))

    def mouseMoveEvent(self, e):
        pos = e.position()
        if not self.mode:
            cursors = {"tl": Qt.SizeFDiagCursor, "br": Qt.SizeFDiagCursor, "tr": Qt.SizeBDiagCursor,
                       "bl": Qt.SizeBDiagCursor, "t": Qt.SizeVerCursor, "b": Qt.SizeVerCursor,
                       "l": Qt.SizeHorCursor, "r": Qt.SizeHorCursor, "move": Qt.SizeAllCursor}
            self.setCursor(cursors.get(self._hit(pos), Qt.CrossCursor))
            return
        p = self._clamp_pt(self.to_img(pos))
        if self.mode == "move":
            d = p - self.press_img
            self.crop = self._clamp_move(self.press_crop.translated(d))
        elif self.mode in ("tl", "tr", "br", "bl", "new", "corner"):
            self.crop = self._from_anchor(self.anchor, p)
        else:
            c = QRectF(self.press_crop)
            if self.mode == "l":
                c.setLeft(min(p.x(), c.right() - 1))
            elif self.mode == "r":
                c.setRight(max(p.x(), c.left() + 1))
            elif self.mode == "t":
                c.setTop(min(p.y(), c.bottom() - 1))
            elif self.mode == "b":
                c.setBottom(max(p.y(), c.top() + 1))
            self.crop = c
        self.changed.emit()
        self.update()

    def _from_anchor(self, a: QPointF, p: QPointF) -> QRectF:
        dx, dy = p.x() - a.x(), p.y() - a.y()
        sx, sy = (1 if dx >= 0 else -1), (1 if dy >= 0 else -1)
        maxw = self.W - a.x() if sx > 0 else a.x()
        maxh = self.H - a.y() if sy > 0 else a.y()
        w, h = abs(dx), abs(dy)
        if self.ratio:
            w = min(max(w, h * self.ratio), maxw)
            h = w / self.ratio
            if h > maxh:
                h = maxh
                w = h * self.ratio
        w, h = max(w, 1), max(h, 1)
        return QRectF(a, QPointF(a.x() + sx * w, a.y() + sy * h)).normalized()

    def mouseReleaseEvent(self, _):
        self.mode = None

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        p.setRenderHint(QPainter.SmoothPixmapTransform)
        ir = self.img_rect()
        p.drawPixmap(ir, self.pix, QRectF(self.pix.rect()))
        v = self.view_rect(self.crop)
        shade = QPainterPath()
        shade.addRect(ir)
        hole = QPainterPath()
        hole.addRect(v)
        p.fillPath(shade.subtracted(hole), QColor(0, 0, 0, 140))
        p.setPen(QPen(QColor(255, 255, 255, 90), 1))
        for i in (1, 2):
            p.drawLine(QPointF(v.left() + v.width() * i / 3, v.top()),
                       QPointF(v.left() + v.width() * i / 3, v.bottom()))
            p.drawLine(QPointF(v.left(), v.top() + v.height() * i / 3),
                       QPointF(v.right(), v.top() + v.height() * i / 3))
        p.setPen(QPen(ACCENT, 2))
        p.setBrush(Qt.NoBrush)
        p.drawRect(v)
        p.setBrush(ACCENT)
        p.setPen(QPen(QColor("white"), 1.5))
        for name, pt in self._handle_points().items():
            if self.ratio and len(name) == 1:
                continue
            p.drawEllipse(pt, 5.5, 5.5)


class CropEditor(BaseEditor):
    RATIOS = [("Free", None), ("1:1", 1.0), ("16:9", 16 / 9), ("9:16", 9 / 16), ("4:3", 4 / 3),
              ("3:4", 3 / 4)]

    def __init__(self, src, notify):
        super().__init__(src, "Crop Image", notify)
        self.img = conv.open_image(src)
        self.canvas = CropCanvas(pil_to_qimage(self.img))
        self.layout_.addWidget(self.canvas, 1)

        row = QHBoxLayout()
        row.addWidget(self.section("Aspect ratio"))
        seg, self.ratio_group = self.seg_buttons([r[0] for r in self.RATIOS],
                                                 lambda i: self.canvas.set_ratio(self.RATIOS[i][1]))
        row.addLayout(seg)
        row.addStretch()
        self.layout_.addLayout(row)

        size = QHBoxLayout()
        self.w_spin, self.h_spin = QSpinBox(), QSpinBox()
        for sp, mx in ((self.w_spin, self.img.width), (self.h_spin, self.img.height)):
            sp.setRange(1, mx)
            sp.setFixedWidth(90)
            sp.editingFinished.connect(self._spin_changed)
        size.addWidget(QLabel("W"))
        size.addWidget(self.w_spin)
        size.addWidget(QLabel("×  H"))
        size.addWidget(self.h_spin)
        size.addWidget(QLabel("px"))
        size.addStretch()
        self.layout_.addLayout(size)

        bottom = QHBoxLayout()
        reset = QPushButton("Reset")
        reset.clicked.connect(self._reset)
        apply = QPushButton("Apply")
        apply.setObjectName("Primary")
        apply.clicked.connect(self._apply)
        bottom.addWidget(reset)
        bottom.addStretch()
        bottom.addWidget(apply)
        self.layout_.addLayout(bottom)

        self.canvas.changed.connect(self._sync_spins)
        self._sync_spins()

    def _sync_spins(self):
        c = self.canvas.crop
        for sp, v in ((self.w_spin, c.width()), (self.h_spin, c.height())):
            sp.blockSignals(True)
            sp.setValue(round(v))
            sp.blockSignals(False)

    def _spin_changed(self):
        w, h = self.w_spin.value(), self.h_spin.value()
        if self.canvas.ratio:
            if self.sender() is self.w_spin:
                h = w / self.canvas.ratio
            else:
                w = h * self.canvas.ratio
        self.canvas.set_size(w, h)
        self._sync_spins()

    def _reset(self):
        self.ratio_group.button(0).setChecked(True)
        self.canvas.ratio = None
        self.canvas.reset()

    def _apply(self):
        c = self.canvas.crop
        box = (round(c.left()), round(c.top()), round(c.right()), round(c.bottom()))
        self.save_image(self.img.crop(box), "Cropped")
        self.close()


# ====================================================================== add background

GRADIENTS = [
    ["#f6b042", "#ef4a2a", "#8b6cf0"], ["#ffd3a5", "#fd6585"], ["#f6d365", "#fda085"],
    ["#a18cd1", "#fbc2eb"], ["#fbc2eb", "#a6c1ee"], ["#89f7fe", "#66a6ff"], ["#2af598", "#009efd"],
    ["#d4fc79", "#96e6a1"], ["#f12711", "#f5af19"], ["#0f2027", "#203a43", "#2c5364"],
]
SOLIDS = ["#ffffff", "#f1f1f1", "#ffd43b", "#94d82d", "#20c997", "#1c7c54", "#4263eb",
          "#1b2a4a", "#212121", "#7950f2"]


def make_background(spec: dict, size: tuple[int, int]) -> Image.Image:
    w, h = size
    kind = spec["type"]
    if kind == "none":
        return Image.new("RGBA", size, (0, 0, 0, 0))
    if kind == "solid":
        return Image.new("RGBA", size, QColor(spec["color"]).getRgb())
    if kind == "image":
        bg = conv.open_image(spec["path"]).convert("RGBA")
        return ImageOps.fit(bg, size, Image.LANCZOS)
    cols = np.array([QColor(c).getRgb()[:3] for c in spec["colors"]], dtype=np.float32)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    t = (xx / max(w - 1, 1) + yy / max(h - 1, 1)) / 2  # diagonal, top-left -> bottom-right
    stops = np.linspace(0, 1, len(cols))
    out = np.empty((h, w, 3), np.float32)
    for ch in range(3):
        out[..., ch] = np.interp(t, stops, cols[:, ch])
    return Image.fromarray(out.astype(np.uint8), "RGB").convert("RGBA")


def compose_background(img: Image.Image, spec: dict, padding: int, radius: int, shadow: int,
                       ratio: float | None) -> Image.Image:
    img = img.convert("RGBA")
    w, h = img.size
    cw, ch = w + 2 * padding, h + 2 * padding
    if ratio:
        if cw / ch < ratio:
            cw = round(ch * ratio)
        else:
            ch = round(cw / ratio)
    canvas = make_background(spec, (cw, ch))
    x, y = (cw - w) // 2, (ch - h) // 2
    radius = min(radius, w // 2, h // 2)
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], radius, fill=255)
    if shadow > 0:
        sh = Image.new("L", (cw, ch), 0)
        off = max(1, shadow // 3)
        ImageDraw.Draw(sh).rounded_rectangle([x, y + off, x + w - 1, y + h - 1 + off], radius,
                                             fill=min(200, 90 + shadow))
        sh = sh.filter(ImageFilter.GaussianBlur(max(1, shadow / 2)))
        layer = Image.new("RGBA", (cw, ch), (0, 0, 0, 255))
        layer.putalpha(sh)
        canvas.alpha_composite(layer)
    img.putalpha(ImageChops.multiply(img.getchannel("A"), mask))
    canvas.alpha_composite(img, (x, y))
    return canvas


class AddBgEditor(BaseEditor):
    RATIOS = [("Auto", None), ("1:1", 1.0), ("16:9", 16 / 9), ("4:3", 4 / 3), ("9:16", 9 / 16)]

    def __init__(self, src, notify):
        super().__init__(src, "Add Background", notify)
        self.img = conv.open_image(src).convert("RGBA")
        self.small, self.s = fit_preview(self.img, 700)
        big = max(self.img.size)
        self.defaults = dict(padding=round(big * 0.08), radius=round(big * 0.025),
                             shadow=30, ratio=None, spec={"type": "gradient", "colors": GRADIENTS[0]})
        self.state = dict(self.defaults)

        self.preview = QLabel()
        self.preview.setAlignment(Qt.AlignCenter)
        self.preview.setMinimumSize(460, 340)
        self.layout_.addWidget(self.preview, 1)

        self.layout_.addWidget(self.section("Background"))
        grid = QGridLayout()
        grid.setSpacing(5)
        self.swatches = QButtonGroup(self)
        specs = [{"type": "gradient", "colors": g} for g in GRADIENTS] + \
                [{"type": "solid", "color": c} for c in SOLIDS]
        self._specs = specs
        for i, spec in enumerate(specs):
            b = self._swatch(spec)
            self.swatches.addButton(b, i)
            grid.addWidget(b, i // 10, i % 10)
        self.swatches.button(0).setChecked(True)
        self.swatches.idClicked.connect(lambda i: self._set_spec(self._specs[i]))
        self.layout_.addLayout(grid)
        extras = QHBoxLayout()
        for lab, act in (("Transparent", {"type": "none"}), ("Custom colour…", "pick_color"),
                         ("Image…", "pick_image")):
            b = QPushButton(lab)
            b.setCursor(Qt.PointingHandCursor)
            b.clicked.connect(lambda _=False, a=act: self._extra(a))
            extras.addWidget(b)
        extras.addStretch()
        self.layout_.addLayout(extras)

        form = QGridLayout()
        form.setHorizontalSpacing(10)
        maxpad = max(400, round(big * 0.4))
        self.pad = self.slider(0, maxpad, self.state["padding"], lambda v: self._set("padding", v))
        self.rad = self.slider(0, max(200, round(big * 0.2)), self.state["radius"], lambda v: self._set("radius", v))
        self.sha = self.slider(0, 100, self.state["shadow"], lambda v: self._set("shadow", v))
        self.vals = {}
        for r, (name, s, key) in enumerate((("Padding", self.pad, "padding"), ("Corners", self.rad, "radius"),
                                            ("Shadow", self.sha, "shadow"))):
            form.addWidget(self.section(name), r, 0)
            form.addWidget(s, r, 1)
            lab = QLabel()
            lab.setFixedWidth(56)
            lab.setObjectName("Section")
            self.vals[key] = lab
            form.addWidget(lab, r, 2)
        form.addWidget(self.section("Ratio"), 3, 0)
        seg, self.ratio_group = self.seg_buttons([r[0] for r in self.RATIOS],
                                                 lambda i: self._set("ratio", self.RATIOS[i][1]))
        form.addLayout(seg, 3, 1)
        self.layout_.addLayout(form)

        bottom = QHBoxLayout()
        reset = QPushButton("Reset")
        reset.clicked.connect(self._reset)
        save = QPushButton("Save with Background")
        save.setObjectName("Primary")
        save.clicked.connect(self._save)
        bottom.addWidget(reset)
        bottom.addStretch()
        bottom.addWidget(save)
        self.layout_.addLayout(bottom)

        self._timer = QTimer(self, singleShot=True, interval=25, timeout=self._render)
        self._render()

    def _swatch(self, spec) -> QPushButton:
        b = QPushButton()
        b.setCheckable(True)
        b.setFixedSize(30, 30)
        b.setCursor(Qt.PointingHandCursor)
        if spec["type"] == "gradient":
            stops = ", ".join(f"stop:{i / (len(spec['colors']) - 1):.2f} {c}" for i, c in enumerate(spec["colors"]))
            bg = f"qlineargradient(x1:0, y1:0, x2:1, y2:1, {stops})"
        else:
            bg = spec["color"]
        b.setStyleSheet(f"QPushButton {{ background: {bg}; border: 1px solid #e6c2ae; border-radius: 8px; }}"
                        f"QPushButton:checked {{ border: 3px solid #ef4a2a; }}")
        return b

    def _extra(self, act):
        if act == "pick_color":
            c = QColorDialog.getColor(QColor("#ffffff"), self, "Background colour")
            if c.isValid():
                self._set_spec({"type": "solid", "color": c.name()})
        elif act == "pick_image":
            path, _ = QFileDialog.getOpenFileName(self, "Background image", str(Path(self.src).parent),
                                                  "Images (*.png *.jpg *.jpeg *.webp *.heic *.avif *.bmp *.tif *.tiff)")
            if path:
                self._set_spec({"type": "image", "path": path})
        else:
            self._set_spec(act)

    def _set_spec(self, spec):
        if spec not in self._specs:
            checked = self.swatches.checkedButton()
            if checked:
                self.swatches.setExclusive(False)
                checked.setChecked(False)
                self.swatches.setExclusive(True)
        self._set("spec", spec)

    def _set(self, key, val):
        self.state[key] = val
        self._timer.start()

    def _render(self):
        st, s = self.state, self.s
        for key in ("padding", "radius"):
            self.vals[key].setText(f"{st[key]} px")
        self.vals["shadow"].setText(f"{st['shadow']}")
        out = compose_background(self.small, st["spec"], round(st["padding"] * s), round(st["radius"] * s),
                                 round(st["shadow"] * s * max(self.img.size) / 1000) if st["shadow"] else 0,
                                 st["ratio"])
        pm = pil_to_pixmap(out)
        box = self.preview.size()
        self.preview.setPixmap(pm.scaled(box.width() - 10, box.height() - 10, Qt.KeepAspectRatio,
                                         Qt.SmoothTransformation))

    def resizeEvent(self, e):
        super().resizeEvent(e)
        self._timer.start()

    def _reset(self):
        self.state = dict(self.defaults)
        for s, k in ((self.pad, "padding"), (self.rad, "radius"), (self.sha, "shadow")):
            s.blockSignals(True)
            s.setValue(self.state[k])
            s.blockSignals(False)
        self.swatches.button(0).setChecked(True)
        self.ratio_group.button(0).setChecked(True)
        self._render()

    def _save(self):
        st = self.state
        shadow = round(st["shadow"] * max(self.img.size) / 1000) if st["shadow"] else 0
        QApplication.setOverrideCursor(Qt.WaitCursor)
        try:
            out = compose_background(self.img, st["spec"], st["padding"], st["radius"], shadow, st["ratio"])
            self.save_image(out, "With Background", force_png=True)
        finally:
            QApplication.restoreOverrideCursor()
        self.close()


# ====================================================================== annotate / redact

class DrawCanvas(ImageView):
    def __init__(self, qimg: QImage, pixelated: QImage | None = None):
        super().__init__(qimg)
        self.pixelated = pixelated
        self.shapes: list[dict] = []
        self.current: dict | None = None
        self.tool = "pen"
        self.color = QColor("#ef4a2a")
        self.width_px = 6  # on-screen width
        self.on_text: Callable[[QPointF], None] | None = None
        self.setCursor(Qt.CrossCursor)

    def mousePressEvent(self, e):
        if e.button() != Qt.LeftButton:
            return
        p = self.to_img(e.position())
        w = self.width_px / self.scale()
        if self.tool == "text":
            if self.on_text:
                self.on_text(p)
            return
        self.current = {"tool": self.tool, "color": QColor(self.color), "width": w, "pts": [p, p]}
        self.update()

    def mouseMoveEvent(self, e):
        if not self.current:
            return
        p = self.to_img(e.position())
        if self.current["tool"] in ("pen", "highlight"):
            self.current["pts"].append(p)
        else:
            self.current["pts"][1] = p
        self.update()

    def mouseReleaseEvent(self, _):
        if self.current:
            a, b = self.current["pts"][0], self.current["pts"][-1]
            if len(self.current["pts"]) > 2 or (a - b).manhattanLength() > 2:
                self.shapes.append(self.current)
            self.current = None
            self.update()

    def add_text(self, p: QPointF, text: str):
        self.shapes.append({"tool": "text", "color": QColor(self.color),
                            "width": self.width_px / self.scale(), "pts": [p], "text": text})
        self.update()

    def undo(self):
        if self.shapes:
            self.shapes.pop()
            self.update()

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        p.setRenderHint(QPainter.SmoothPixmapTransform)
        r = self.img_rect()
        p.translate(r.topLeft())
        p.scale(self.scale(), self.scale())
        p.drawPixmap(0, 0, self.pix)
        render_shapes(p, self.shapes + ([self.current] if self.current else []), self.pixelated)

    def render_full(self) -> QImage:
        out = self.qimg.convertToFormat(QImage.Format_ARGB32)
        p = QPainter(out)
        p.setRenderHint(QPainter.Antialiasing)
        render_shapes(p, self.shapes, self.pixelated)
        p.end()
        return out


def render_shapes(p: QPainter, shapes: list[dict], pixelated: QImage | None):
    for s in shapes:
        tool, color, w, pts = s["tool"], s["color"], s["width"], s["pts"]
        if tool in ("box", "pixelate", "rect", "arrow"):
            rect = QRectF(pts[0], pts[-1]).normalized()
        if tool == "box":
            p.fillRect(rect, QColor("black"))
        elif tool == "pixelate" and pixelated is not None:
            p.drawImage(rect, pixelated, rect)
        elif tool == "rect":
            p.setPen(QPen(color, w, Qt.SolidLine, Qt.RoundCap, Qt.RoundJoin))
            p.setBrush(Qt.NoBrush)
            p.drawRoundedRect(rect, w, w)
        elif tool in ("pen", "highlight"):
            c = QColor(color)
            width = w
            if tool == "highlight":
                c.setAlpha(90)
                width = w * 3
            p.setPen(QPen(c, width, Qt.SolidLine, Qt.RoundCap, Qt.RoundJoin))
            p.setBrush(Qt.NoBrush)
            path = QPainterPath(pts[0])
            for q in pts[1:]:
                path.lineTo(q)
            p.drawPath(path)
        elif tool == "arrow":
            a, b = pts[0], pts[-1]
            p.setPen(QPen(color, w, Qt.SolidLine, Qt.RoundCap, Qt.RoundJoin))
            p.drawLine(a, b)
            ang = math.atan2(b.y() - a.y(), b.x() - a.x())
            head = max(w * 4, 12)
            l = QPointF(b.x() - head * math.cos(ang - 0.45), b.y() - head * math.sin(ang - 0.45))
            r = QPointF(b.x() - head * math.cos(ang + 0.45), b.y() - head * math.sin(ang + 0.45))
            p.setBrush(color)
            p.drawPolygon(QPolygonF([b, l, r]))
        elif tool == "text":
            f = QFont(FONT, 1)
            f.setPixelSize(max(10, round(w * 5)))
            f.setBold(True)
            p.setFont(f)
            p.setPen(color)
            p.drawText(pts[0], s["text"])


class DrawEditor(BaseEditor):
    def __init__(self, src, notify, redact: bool):
        super().__init__(src, "Redact" if redact else "Annotate", notify)
        self.redact = redact
        self.img = conv.open_image(src)
        qimg = pil_to_qimage(self.img)
        pixelated = None
        if redact:
            block = max(8, max(self.img.size) // 60)
            small = self.img.convert("RGBA").resize(
                (max(1, self.img.width // block), max(1, self.img.height // block)), Image.BILINEAR)
            pixelated = pil_to_qimage(small.resize(self.img.size, Image.NEAREST))
        self.canvas = DrawCanvas(qimg, pixelated)
        self.canvas.on_text = self._text
        self.layout_.addWidget(self.canvas, 1)

        bar = QHBoxLayout()
        if redact:
            tools = [("Black box", "box"), ("Pixelate", "pixelate")]
        else:
            tools = [("Pen", "pen"), ("Arrow", "arrow"), ("Box", "rect"), ("Highlight", "highlight"),
                     ("Text", "text")]
        seg, _ = self.seg_buttons([t[0] for t in tools], lambda i: setattr(self.canvas, "tool", tools[i][1]))
        self.canvas.tool = tools[0][1]
        bar.addLayout(seg)
        bar.addSpacing(10)
        if not redact:
            colors = ["#ef4a2a", "#fd7e14", "#fcc419", "#40c057", "#228be6", "#7950f2", "#000000", "#ffffff"]
            group = QButtonGroup(self)
            for i, c in enumerate(colors):
                b = QPushButton()
                b.setCheckable(True)
                b.setChecked(i == 0)
                b.setFixedSize(22, 22)
                b.setStyleSheet(f"QPushButton {{ background: {c}; border: 1px solid #d8b6a4; border-radius: 11px; }}"
                                f"QPushButton:checked {{ border: 3px solid #4a2a1c; }}")
                b.clicked.connect(lambda _=False, col=c: setattr(self.canvas, "color", QColor(col)))
                group.addButton(b)
                bar.addWidget(b)
            bar.addSpacing(10)
            bar.addWidget(self.section("Size"))
            sz = self.slider(2, 30, 6, lambda v: setattr(self.canvas, "width_px", v))
            sz.setFixedWidth(110)
            bar.addWidget(sz)
        bar.addStretch()
        self.layout_.addLayout(bar)

        bottom = QHBoxLayout()
        undo = QPushButton("Undo")
        undo.clicked.connect(self.canvas.undo)
        undo.setShortcut("Ctrl+Z")
        clear = QPushButton("Clear")
        clear.clicked.connect(lambda: (self.canvas.shapes.clear(), self.canvas.update()))
        save = QPushButton("Save")
        save.setObjectName("Primary")
        save.clicked.connect(self._save)
        bottom.addWidget(undo)
        bottom.addWidget(clear)
        bottom.addStretch()
        bottom.addWidget(save)
        self.layout_.addLayout(bottom)

    def _text(self, p: QPointF):
        text, ok = QInputDialog.getText(self, "Add text", "Text:")
        if ok and text:
            self.canvas.add_text(p, text)

    def _save(self):
        out = qimage_to_pil(self.canvas.render_full())
        if self.img.mode not in ("RGBA", "LA", "P"):
            out = out.convert("RGB")
        self.save_image(out, "Redacted" if self.redact else "Annotated")
        self.close()


# ====================================================================== edit (adjustments)

def apply_edits(img: Image.Image, st: dict) -> Image.Image:
    out = img
    if st["rotate"]:
        out = out.rotate(-st["rotate"], expand=True)
    if st["flip_h"]:
        out = ImageOps.mirror(out)
    if st["flip_v"]:
        out = ImageOps.flip(out)
    alpha = out.getchannel("A") if out.mode == "RGBA" else None
    rgb = out.convert("RGB")
    for key, enh in (("brightness", ImageEnhance.Brightness), ("contrast", ImageEnhance.Contrast),
                     ("saturation", ImageEnhance.Color), ("sharpness", ImageEnhance.Sharpness)):
        if st[key]:
            rgb = enh(rgb).enhance(1 + st[key] / 100)
    if st["gray"]:
        rgb = ImageOps.grayscale(rgb).convert("RGB")
    if alpha is not None:
        rgb.putalpha(alpha)
    return rgb


class EditEditor(BaseEditor):
    DEFAULT = dict(rotate=0, flip_h=False, flip_v=False, brightness=0, contrast=0, saturation=0,
                   sharpness=0, gray=False)

    def __init__(self, src, notify):
        super().__init__(src, "Edit Image", notify)
        self.img = conv.open_image(src)
        self.small, _ = fit_preview(self.img, 800)
        self.state = dict(self.DEFAULT)

        self.preview = QLabel()
        self.preview.setAlignment(Qt.AlignCenter)
        self.preview.setMinimumSize(460, 340)
        self.layout_.addWidget(self.preview, 1)

        row = QHBoxLayout()
        for lab, fn in (("⟲ Rotate left", lambda: self._rot(-90)), ("⟳ Rotate right", lambda: self._rot(90)),
                        ("⇋ Flip H", lambda: self._toggle("flip_h")), ("⇵ Flip V", lambda: self._toggle("flip_v"))):
            b = QPushButton(lab)
            b.clicked.connect(fn)
            row.addWidget(b)
        self.gray_btn = QPushButton("Black && white")
        self.gray_btn.setCheckable(True)
        self.gray_btn.toggled.connect(lambda v: self._set("gray", v))
        row.addWidget(self.gray_btn)
        row.addStretch()
        self.layout_.addLayout(row)

        form = QGridLayout()
        self.sliders = {}
        for r, key in enumerate(("brightness", "contrast", "saturation", "sharpness")):
            form.addWidget(self.section(key.capitalize()), r, 0)
            s = self.slider(-100, 100, 0, lambda v, k=key: self._set(k, v))
            self.sliders[key] = s
            form.addWidget(s, r, 1)
        self.layout_.addLayout(form)

        bottom = QHBoxLayout()
        reset = QPushButton("Reset")
        reset.clicked.connect(self._reset)
        save = QPushButton("Save")
        save.setObjectName("Primary")
        save.clicked.connect(self._save)
        bottom.addWidget(reset)
        bottom.addStretch()
        bottom.addWidget(save)
        self.layout_.addLayout(bottom)

        self._timer = QTimer(self, singleShot=True, interval=25, timeout=self._render)
        self._render()

    def _rot(self, d):
        self._set("rotate", (self.state["rotate"] + d) % 360)

    def _toggle(self, k):
        self._set(k, not self.state[k])

    def _set(self, k, v):
        self.state[k] = v
        self._timer.start()

    def _render(self):
        pm = pil_to_pixmap(apply_edits(self.small, self.state))
        box = self.preview.size()
        self.preview.setPixmap(pm.scaled(box.width() - 10, box.height() - 10, Qt.KeepAspectRatio,
                                         Qt.SmoothTransformation))

    def resizeEvent(self, e):
        super().resizeEvent(e)
        self._timer.start()

    def _reset(self):
        self.state = dict(self.DEFAULT)
        for s in self.sliders.values():
            s.blockSignals(True)
            s.setValue(0)
            s.blockSignals(False)
        self.gray_btn.blockSignals(True)
        self.gray_btn.setChecked(False)
        self.gray_btn.blockSignals(False)
        self._render()

    def _save(self):
        QApplication.setOverrideCursor(Qt.WaitCursor)
        try:
            self.save_image(apply_edits(self.img, self.state), "Edited")
        finally:
            QApplication.restoreOverrideCursor()
        self.close()


# ====================================================================== metadata

class MetadataEditor(BaseEditor):
    def __init__(self, src, notify):
        super().__init__(src, "Metadata", notify)
        rows = conv.read_metadata(src)
        table = QTableWidget(len(rows), 2)
        table.setHorizontalHeaderLabels(["Field", "Value"])
        table.verticalHeader().setVisible(False)
        table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeToContents)
        table.horizontalHeader().setStretchLastSection(True)
        table.setEditTriggers(QTableWidget.NoEditTriggers)
        for r, (k, v) in enumerate(rows):
            table.setItem(r, 0, QTableWidgetItem(k))
            table.setItem(r, 1, QTableWidgetItem(v))
        table.setMinimumSize(460, 320)
        self.layout_.addWidget(table, 1)
        self.rows = rows

        bottom = QHBoxLayout()
        copy = QPushButton("Copy all")
        copy.clicked.connect(lambda: QApplication.clipboard().setText(
            "\n".join(f"{k}: {v}" for k, v in self.rows)))
        strip = QPushButton("Save copy without metadata")
        strip.setObjectName("Primary")
        strip.clicked.connect(self._strip)
        bottom.addWidget(copy)
        bottom.addStretch()
        bottom.addWidget(strip)
        self.layout_.addLayout(bottom)

    def _strip(self):
        out = conv.strip_metadata(self.src)[0]
        self.notify("Saved clean copy", out)
        self.close()


def open_editor(tool: str, src: str, notify: Notify) -> QWidget:
    if tool == "crop":
        return CropEditor(src, notify)
    if tool == "addbg":
        return AddBgEditor(src, notify)
    if tool == "annotate":
        return DrawEditor(src, notify, redact=False)
    if tool == "redact":
        return DrawEditor(src, notify, redact=True)
    if tool == "edit":
        return EditEditor(src, notify)
    if tool == "metadata":
        return MetadataEditor(src, notify)
    raise ValueError(tool)
