"""Shared colours, stylesheet and PIL <-> Qt image helpers."""
from PIL import Image
from PySide6.QtGui import QColor, QFont, QImage, QPixmap

from .plat import IS_MAC, UI_FONT

ACCENT = QColor("#ef4a2a")
ACCENT_DARK = QColor("#c9381c")
CREAM = QColor(255, 236, 220, 235)
CREAM_EDGE = QColor(255, 255, 255, 170)
TEXT = QColor("#5a3220")
FONT = UI_FONT
# macOS sizes fonts at 72 points per inch, Windows and Linux at 96: scale so text looks the same.
FONT_SCALE = 4 / 3 if IS_MAC else 1.0


def font(points: float, bold: bool = False, family: str = "") -> QFont:
    f = QFont(family or FONT)
    f.setPointSizeF(points * FONT_SCALE)
    f.setBold(bold)
    return f

STYLESHEET = """
QWidget#Editor { background: #fff4ec; }
QWidget { font-family: '%s'; font-size: 13px; color: #4a2a1c; }
QLabel#Title { font-size: 15px; font-weight: 600; }
QLabel#Section { color: #8a5a44; font-size: 12px; }
QPushButton {
    background: #fde3d3; border: 1px solid #f5c6ad; border-radius: 7px; padding: 5px 12px;
}
QPushButton:hover { background: #fbd3bb; }
QPushButton:checked { background: #ef4a2a; color: white; border-color: #ef4a2a; }
QPushButton#Primary { background: #ef4a2a; color: white; border-color: #ef4a2a; font-weight: 600; }
QPushButton#Primary:hover { background: #d93e20; }
QSpinBox { background: white; border: 1px solid #f0c9b3; border-radius: 6px; padding: 3px 6px; }
QSlider::groove:horizontal { height: 4px; background: #f3d2c0; border-radius: 2px; }
QSlider::sub-page:horizontal { background: #ef4a2a; border-radius: 2px; }
QSlider::handle:horizontal {
    background: white; border: 1px solid #e8b9a1; width: 14px; height: 14px; margin: -6px 0;
    border-radius: 7px;
}
QTableWidget { background: white; border: 1px solid #f0c9b3; border-radius: 6px;
               gridline-color: #f6e0d4; }
QHeaderView::section { background: #fde3d3; border: none; padding: 4px; font-weight: 600; }
""" % UI_FONT


def pil_to_qimage(img: Image.Image) -> QImage:
    rgba = img.convert("RGBA")
    data = rgba.tobytes("raw", "RGBA")
    return QImage(data, rgba.width, rgba.height, rgba.width * 4, QImage.Format_RGBA8888).copy()


def pil_to_pixmap(img: Image.Image) -> QPixmap:
    return QPixmap.fromImage(pil_to_qimage(img))


def qimage_to_pil(qimg: QImage) -> Image.Image:
    q = qimg.convertToFormat(QImage.Format_RGBA8888)
    w, h, bpl = q.width(), q.height(), q.bytesPerLine()
    buf = bytes(q.constBits())[: bpl * h]
    return Image.frombuffer("RGBA", (w, h), buf, "raw", "RGBA", bpl, 1).copy()
