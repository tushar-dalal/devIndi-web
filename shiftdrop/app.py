"""ShiftDrop — drag files, press Shift, drop on the wheel to convert or edit them.

Runs on Windows, macOS and Linux; OS-specific bits live in plat.py.
"""
from __future__ import annotations

import logging
import os
import sys
import traceback
from pathlib import Path

from PySide6.QtCore import (QBuffer, QDir, QIODevice, QLockFile, QObject, QPoint, QRunnable, QSettings, Qt,
                            QThreadPool, QTimer, Signal)
from PySide6.QtGui import QAction, QColor, QCursor, QFont, QGuiApplication, QIcon, QPainter, QPen, QPixmap
from PySide6.QtWidgets import QApplication, QMenu, QMessageBox, QSystemTrayIcon

from . import converters as conv
from . import plat
from .dock import DockWindow
from .editors import open_editor
from .toast import Toast
from .wheel import WheelWindow

APP_NAME = "ShiftDrop"
VERSION = "1.1.0"
DATA_DIR = plat.data_dir()
logging.basicConfig(filename=DATA_DIR / "shiftdrop.log", level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(APP_NAME)


# ------------------------------------------------------------------ background jobs

class JobSignals(QObject):
    progress = Signal(int, str)
    finished = Signal(str)
    failed = Signal(str)


class Job(QRunnable):
    def __init__(self, paths: list[str], kind: str, value: str):
        super().__init__()
        self.paths, self.kind, self.value = paths, kind, value
        self.signals = JobSignals()

    def run(self):
        done, before, after, errors = 0, 0, 0, []
        try:
            if self.kind == "tool" and self.value == "merge":
                out = conv.merge_pdf(self.paths)
                self.signals.progress.emit(1, str(out[0]))
                self.signals.finished.emit(f"Merged {len(self.paths)} files")
                return
            for p in self.paths:
                try:
                    if self.kind == "convert":
                        outs = conv.convert(p, self.value)
                    elif self.value == "compress":
                        outs = conv.compress(p)
                        before += os.path.getsize(p)
                        after += sum(o.stat().st_size for o in outs)
                    elif self.value == "clean":
                        outs = conv.strip_metadata(p)
                    else:
                        raise ValueError(self.value)
                    done += 1
                    self.signals.progress.emit(done, str(outs[-1]))
                except Exception as e:  # keep going with the other files
                    log.exception("Failed on %s", p)
                    errors.append(f"{Path(p).name}: {e}")
            if errors and not done:
                self.signals.failed.emit(errors[0])
            elif errors:
                self.signals.finished.emit(f"{done} saved, {len(errors)} failed")
            elif self.value == "compress" and before:
                pct = 100 - round(after * 100 / before)
                self.signals.finished.emit(f"{conv.human_size(before)} → {conv.human_size(after)} ({pct:+d}% smaller)"
                                           .replace("+-", "-").replace("(+", "("))
            else:
                self.signals.finished.emit(f"{done} of {len(self.paths)} saved")
        except Exception as e:
            log.exception("Job failed")
            self.signals.failed.emit(str(e))


# ------------------------------------------------------------------ drag watcher

class DragWatcher(QObject):
    """Polls global mouse/keyboard state: primary button held + moved + Shift -> open the wheel.

    The wheel first appears as an invisible probe and only shows itself once files are dragged
    over it, so Shift-dragging text or windows never pops it up.
    """

    def __init__(self, app: "ShiftDropApp"):
        super().__init__()
        self.app = app
        self.input = app.input
        self.prev_btn = False
        self.prev_shift = False
        self.down_pos = None
        self.down_ok = False
        self.shown_this_press = False
        self.timer = QTimer(self, interval=15, timeout=self.tick)
        if self.input.available:
            self.timer.start()

    def tick(self):
        btn = self.input.primary_down()
        shift = self.input.shift_down()
        wheel = self.app.wheel
        pos = QCursor.pos()

        if btn and not self.prev_btn:
            self.down_pos = pos
            self.shown_this_press = False
            self.down_ok = self.input.drag_source_ok(self.app.explorer_only)

        if btn and self.app.enabled:
            if wheel.isVisible() and self.shown_this_press:
                if shift and not self.prev_shift and not wheel.probing:
                    wheel.toggle_page()
            elif shift and not self.shown_this_press and self.down_ok and self.down_pos is not None \
                    and (pos - self.down_pos).manhattanLength() > 12:
                wheel.show_at(pos, probe=True)
                self.shown_this_press = True

        if not btn and self.prev_btn and wheel.isVisible() and not wheel.leave_hides:
            QTimer.singleShot(250, self._hide_if_released)

        self.prev_btn, self.prev_shift = btn, shift

    def _hide_if_released(self):
        if not self.input.primary_down() and not self.app.wheel.leave_hides:
            self.app.wheel.hide()


# ------------------------------------------------------------------ application

def make_icon(size: int = 64) -> QIcon:
    pm = QPixmap(size, size)
    pm.fill(Qt.transparent)
    p = QPainter(pm)
    p.setRenderHint(QPainter.Antialiasing)
    p.scale(size / 64, size / 64)
    p.setBrush(QColor("#ef4a2a"))
    p.setPen(Qt.NoPen)
    p.drawEllipse(2, 2, 60, 60)
    p.setPen(QPen(QColor(255, 255, 255, 230), 5, Qt.SolidLine, Qt.FlatCap))
    for i in range(6):
        p.drawArc(13, 13, 38, 38, i * 60 * 16 + 8 * 16, 44 * 16)
    p.setBrush(QColor("white"))
    p.setPen(Qt.NoPen)
    p.drawEllipse(25, 25, 14, 14)
    p.end()
    return QIcon(pm)


class ShiftDropApp(QObject):
    def __init__(self, qapp: QApplication):
        super().__init__()
        self.qapp = qapp
        self.settings = QSettings(APP_NAME, APP_NAME)
        self.enabled = self.settings.value("enabled", True, bool)
        self.explorer_only = self.settings.value("explorer_only", True, bool)
        self.input = plat.make_input()
        # The dock is the only way in when the OS hides global input (Linux on Wayland).
        self.show_dock = self.settings.value("show_dock", not self.input.available, bool)
        self.pool = QThreadPool.globalInstance()
        self.editors = []
        self.jobs = []

        self.wheel = WheelWindow()
        self.wheel.dropped.connect(self.on_dropped)
        self.toast = Toast()
        self.watcher = DragWatcher(self)
        self.dock = DockWindow()
        self.dock.files_entered.connect(self._dock_entered)
        if self.show_dock and self.enabled:
            self.dock.show()
        self._build_tray()

    def _dock_entered(self, pos: QPoint):
        if not self.enabled or (self.wheel.isVisible() and not self.wheel.probing):
            return
        # Open the wheel just inside the dock so the drag can carry on into it.
        self.wheel.show_at(QPoint(pos.x() - WheelWindow.SIZE // 2 - 24, pos.y()), leave_hides=True)

    # ---------------------------------------------------------------- tray
    def _build_tray(self):
        self.tray = QSystemTrayIcon(make_icon(), self.qapp)
        self.tray.setToolTip("ShiftDrop — drag files, press Shift")
        menu = QMenu()
        head = QAction(f"ShiftDrop {VERSION}", menu)
        head.setEnabled(False)
        menu.addAction(head)
        if not self.input.available and self.input.reason:
            note = QAction(self.input.reason, menu)
            note.setEnabled(False)
            menu.addAction(note)
        menu.addSeparator()
        self.act_enabled = QAction("Enabled", menu, checkable=True, checked=self.enabled)
        self.act_enabled.toggled.connect(self._toggle_enabled)
        menu.addAction(self.act_enabled)
        if plat.IS_WIN:
            self.act_explorer = QAction("Only when dragging from Explorer / Desktop", menu, checkable=True,
                                        checked=self.explorer_only)
            self.act_explorer.toggled.connect(lambda v: self._set("explorer_only", v))
            menu.addAction(self.act_explorer)
        self.act_dock = QAction("Show drop dock at screen edge", menu, checkable=True, checked=self.show_dock)
        self.act_dock.toggled.connect(self._toggle_dock)
        menu.addAction(self.act_dock)
        self.act_auto = QAction(plat.AUTOSTART_LABEL, menu, checkable=True, checked=plat.autostart_enabled())
        self.act_auto.toggled.connect(self._toggle_autostart)
        menu.addAction(self.act_auto)
        if plat.IS_LINUX and getattr(sys, "frozen", False):
            self.act_menu = QAction("Show in applications menu", menu, checkable=True,
                                    checked=plat.linux_menu_installed())
            self.act_menu.toggled.connect(self._toggle_linux_menu)
            menu.addAction(self.act_menu)
        menu.addSeparator()
        menu.addAction("How to use", self.show_help)
        menu.addAction("Open log folder", lambda: plat.open_folder(DATA_DIR))
        menu.addSeparator()
        menu.addAction("Quit", self.qapp.quit)
        self.menu = menu
        self.tray.setContextMenu(menu)
        self.tray.activated.connect(lambda r: self.show_help() if r == QSystemTrayIcon.DoubleClick else None)
        self.tray.show()

    def _toggle_enabled(self, on):
        self._set("enabled", on)
        self.dock.setVisible(on and self.show_dock)

    def _toggle_dock(self, on):
        self._set("show_dock", on)
        self.dock.setVisible(on and self.enabled)

    def _toggle_linux_menu(self, on):
        if on:
            buf = QBuffer()
            buf.open(QIODevice.WriteOnly)
            make_icon(256).pixmap(256, 256).save(buf, "PNG")
            plat.install_linux_menu_entry(bytes(buf.data()))
        else:
            plat.remove_linux_menu_entry()

    def _set(self, key, val):
        setattr(self, key, val)
        self.settings.setValue(key, val)

    def _toggle_autostart(self, on):
        try:
            plat.set_autostart(on)
        except OSError as e:
            QMessageBox.warning(None, APP_NAME, f"Couldn't change startup setting:\n{e}")

    def show_help(self):
        if self.input.available:
            how = (f"1. Start dragging one or more files in {plat.FILE_MANAGER}.\n"
                   "2. While still holding the mouse button, press Shift — the wheel appears.\n")
        else:
            how = ("1. Start dragging one or more files in your file manager.\n"
                   "2. Drag them onto the ShiftDrop dock at the right edge of the screen — the wheel appears.\n")
        QMessageBox.information(
            None, "ShiftDrop",
            how +
            "3. Press Shift to switch between Convert and Tools.\n"
            "4. Drop the file on a slice. Drop in the middle to cancel.\n\n"
            "Converted files are saved next to the original.\n\n"
            "Convert: images ↔ PNG/JPG/WEBP/HEIC/TIFF/AVIF/BMP/PDF/DOCX, PDF → DOCX/JPG/PNG/TXT, "
            "TXT/MD → PDF/DOCX, DOCX → PDF/TXT.\n"
            "Tools: Crop, Add BG, Annotate, Redact, Edit, Compress, Metadata, Merge PDF.")

    # ---------------------------------------------------------------- actions
    def on_dropped(self, paths: list[str], kind: str, value: str):
        log.info("drop %s %s %s", kind, value, paths)
        near = QCursor.pos()
        if kind == "tool" and value not in ("compress", "clean", "merge") and len(paths) == 1:
            try:
                ed = open_editor(value, paths[0], self.notify_saved)
            except Exception as e:
                log.exception("editor failed")
                self.toast.start(conv.TOOL_LABELS.get(value, value), 1, near)
                self.toast.fail(str(e))
                return
            self.editors.append(ed)
            ed.destroyed.connect(lambda *_: self.editors.remove(ed) if ed in self.editors else None)
            ed.adjustSize()
            screen = QGuiApplication.screenAt(near) or QGuiApplication.primaryScreen()
            geo = ed.frameGeometry()
            geo.moveCenter(screen.availableGeometry().center())
            ed.move(geo.topLeft())
            plat.bring_to_front(ed)
            return

        if kind == "convert":
            title = f"Converting to {value}"
        else:
            title = {"compress": "Compressing", "clean": "Removing metadata", "merge": "Merging into PDF"}[value]
        total = 1 if value == "merge" else len(paths)
        self.toast.start(title, total, near)
        job = Job(paths, kind, value)
        job.signals.progress.connect(self.toast.progress)
        job.signals.finished.connect(self.toast.finish)
        job.signals.failed.connect(self.toast.fail)
        self.jobs.append(job)  # keep signals alive
        job.signals.finished.connect(lambda *_: self.jobs.remove(job) if job in self.jobs else None)
        job.signals.failed.connect(lambda *_: self.jobs.remove(job) if job in self.jobs else None)
        self.pool.start(job)

    def notify_saved(self, title: str, path: Path):
        self.toast.start(title, 1, QCursor.pos())
        self.toast.progress(1, str(path))
        self.toast.finish(path.name)


def _excepthook(t, v, tb):
    log.error("Unhandled: %s", "".join(traceback.format_exception(t, v, tb)))
    sys.__excepthook__(t, v, tb)


def selftest(folder: str) -> int:
    """Run every converter on the files in `folder` and log the results (checks a packaged build)."""
    failures = 0
    for f in sorted(Path(folder).iterdir()):
        for target in conv.targets_for([str(f)]):
            try:
                outs = conv.convert(str(f), target)
                log.info("selftest OK %s -> %s %s", f.name, target, [o.name for o in outs])
            except Exception:
                failures += 1
                log.exception("selftest FAIL %s -> %s", f.name, target)
    log.info("selftest done, %d failures", failures)
    return 1 if failures else 0


def main():
    sys.excepthook = _excepthook
    if "--selftest" in sys.argv:
        return selftest(sys.argv[sys.argv.index("--selftest") + 1])
    plat.prepare_qt_env()
    QGuiApplication.setHighDpiScaleFactorRoundingPolicy(Qt.HighDpiScaleFactorRoundingPolicy.PassThrough)
    qapp = QApplication(sys.argv)
    qapp.setQuitOnLastWindowClosed(False)
    qapp.setApplicationName(APP_NAME)
    qapp.setFont(QFont(plat.UI_FONT, 9 if plat.IS_WIN else 13 if plat.IS_MAC else 10))

    if "--uninstall" in sys.argv and plat.IS_WIN:
        from . import install
        if "--silent" not in sys.argv and QMessageBox.question(
                None, "Uninstall ShiftDrop", "Remove ShiftDrop and its shortcuts from this PC?") \
                != QMessageBox.Yes:
            return 1
        install.uninstall()
        if "--silent" not in sys.argv:
            QMessageBox.information(None, "Uninstall ShiftDrop", "ShiftDrop has been removed.")
        return 0

    lock =QLockFile(QDir.tempPath() + "/shiftdrop.lock")
    if not lock.tryLock(100):
        QMessageBox.information(None, APP_NAME, "ShiftDrop is already running (see the system tray).")
        return 0

    app = ShiftDropApp(qapp)
    qapp.setWindowIcon(make_icon())
    if "--demo" in sys.argv:
        # Shows the wheel for a file at screen centre (for screenshots); `--demo FILE [tools]`.
        args = sys.argv[sys.argv.index("--demo") + 1:]
        centre = QGuiApplication.primaryScreen().availableGeometry().center()
        app.wheel.show_at(centre)
        app.wheel.load_paths([args[0]])
        if "tools" in args:
            app.wheel.toggle_page()
        app.wheel.hover = 2
        QTimer.singleShot(8000, qapp.quit)
    elif "--smoketest" in sys.argv:
        # Packaged-build check: the tray, wheel and dock all construct, then quit.
        log.info("smoketest ok input=%s reason=%s qpa=%s", app.input.available, app.input.reason,
                 QGuiApplication.platformName())
        QTimer.singleShot(1500, qapp.quit)
    elif "--quiet" not in sys.argv:
        hint = (f"Drag a file in {plat.FILE_MANAGER} and press Shift to open the wheel." if app.input.available
                else "Drag files onto the dock at the right edge of the screen.")
        app.tray.showMessage("ShiftDrop is running", hint, make_icon(), 4000)
    log.info("started")
    return qapp.exec()


if __name__ == "__main__":
    sys.exit(main())
