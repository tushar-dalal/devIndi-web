"""Everything that differs between Windows, macOS and Linux lives here.

- global input state (primary mouse button + Shift) for the drag gesture
- whether a drag started in the file manager (Windows only)
- focusing editor windows, revealing files, data/log folder, start-at-login
"""
from __future__ import annotations

import ctypes
import ctypes.util
import os
import subprocess
import sys
from pathlib import Path

APP_NAME = "ShiftDrop"
IS_WIN = sys.platform == "win32"
IS_MAC = sys.platform == "darwin"
IS_LINUX = sys.platform.startswith("linux")

if IS_WIN:
    UI_FONT, ICON_FONT, FILE_MANAGER = "Segoe UI", "Segoe MDL2 Assets", "Explorer or the Desktop"
    AUTOSTART_LABEL = "Start with Windows"
elif IS_MAC:
    UI_FONT, ICON_FONT, FILE_MANAGER = "Helvetica Neue", "", "Finder or the Desktop"
    AUTOSTART_LABEL = "Open at login"
else:
    UI_FONT, ICON_FONT, FILE_MANAGER = "Sans Serif", "", "your file manager"
    AUTOSTART_LABEL = "Start at login"


def is_wayland() -> bool:
    return IS_LINUX and (os.environ.get("XDG_SESSION_TYPE") == "wayland" or bool(os.environ.get("WAYLAND_DISPLAY")))


def prepare_qt_env():
    """Call before creating QApplication."""
    if IS_LINUX and os.environ.get("DISPLAY") and "QT_QPA_PLATFORM" not in os.environ:
        # Native Wayland forbids placing windows at the cursor; XWayland (xcb) allows it
        # and still accepts drags from Wayland file managers.
        os.environ["QT_QPA_PLATFORM"] = "xcb"


def data_dir() -> Path:
    if IS_WIN:
        base = Path(os.environ.get("LOCALAPPDATA", Path.home()))
    elif IS_MAC:
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local" / "state"))
    d = base / APP_NAME
    d.mkdir(parents=True, exist_ok=True)
    return d


# ====================================================================== input state

class InputState:
    """Polls the global primary-button and Shift state. `available` is False where the OS forbids it."""

    available = False
    reason = ""

    def primary_down(self) -> bool:
        return False

    def shift_down(self) -> bool:
        return False

    def drag_source_ok(self, explorer_only: bool) -> bool:
        return True


class _WinInput(InputState):
    available = True
    # Explorer windows, the desktop, and Open/Save dialogs
    EXPLORER_CLASSES = {"CabinetWClass", "ExploreWClass", "Progman", "WorkerW", "#32770"}

    def __init__(self):
        from ctypes import wintypes
        self.wt = wintypes
        u = ctypes.windll.user32
        u.WindowFromPoint.argtypes = [wintypes.POINT]
        u.WindowFromPoint.restype = wintypes.HWND
        u.GetAncestor.argtypes = [wintypes.HWND, wintypes.UINT]
        u.GetAncestor.restype = wintypes.HWND
        u.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
        self.u = u

    def _down(self, vk):
        return bool(self.u.GetAsyncKeyState(vk) & 0x8000)

    def primary_down(self):
        return self._down(0x02 if self.u.GetSystemMetrics(23) else 0x01)  # SM_SWAPBUTTON

    def shift_down(self):
        return self._down(0x10)

    def drag_source_ok(self, explorer_only):
        if not explorer_only:
            return True
        pt = self.wt.POINT()
        self.u.GetCursorPos(ctypes.byref(pt))
        hwnd = self.u.WindowFromPoint(pt)
        root = self.u.GetAncestor(hwnd, 2) if hwnd else None  # GA_ROOT
        if not root:
            return False
        buf = ctypes.create_unicode_buffer(256)
        self.u.GetClassNameW(root, buf, 256)
        return buf.value in self.EXPLORER_CLASSES


class _MacInput(InputState):
    """CoreGraphics event-source state: readable without Accessibility/Input Monitoring prompts."""

    available = True

    def __init__(self):
        cg = ctypes.CDLL("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics")
        cg.CGEventSourceButtonState.argtypes = [ctypes.c_int32, ctypes.c_uint32]
        cg.CGEventSourceButtonState.restype = ctypes.c_bool
        cg.CGEventSourceFlagsState.argtypes = [ctypes.c_int32]
        cg.CGEventSourceFlagsState.restype = ctypes.c_uint64
        self.cg = cg

    def primary_down(self):
        return bool(self.cg.CGEventSourceButtonState(0, 0))  # combined session state, left button

    def shift_down(self):
        return bool(self.cg.CGEventSourceFlagsState(0) & 0x00020000)  # kCGEventFlagMaskShift


class _X11Input(InputState):
    available = True

    def __init__(self):
        name = ctypes.util.find_library("X11") or "libX11.so.6"
        x = ctypes.CDLL(name)
        x.XOpenDisplay.restype = ctypes.c_void_p
        x.XOpenDisplay.argtypes = [ctypes.c_char_p]
        x.XDefaultRootWindow.restype = ctypes.c_ulong
        x.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
        x.XQueryPointer.argtypes = [ctypes.c_void_p, ctypes.c_ulong] + [ctypes.c_void_p] * 7
        self.x = x
        self.dpy = x.XOpenDisplay(None)
        if not self.dpy:
            raise OSError("cannot open X display")
        self.root = x.XDefaultRootWindow(self.dpy)
        self._mask = 0

    def _poll(self):
        r, c = ctypes.c_ulong(), ctypes.c_ulong()
        i = [ctypes.c_int() for _ in range(4)]
        m = ctypes.c_uint()
        self.x.XQueryPointer(self.dpy, self.root, ctypes.byref(r), ctypes.byref(c),
                             *[ctypes.byref(v) for v in i], ctypes.byref(m))
        self._mask = m.value

    def primary_down(self):
        self._poll()
        return bool(self._mask & (1 << 8))  # Button1Mask

    def shift_down(self):
        return bool(self._mask & 1)  # ShiftMask (from the same poll)


def make_input() -> InputState:
    try:
        if IS_WIN:
            return _WinInput()
        if IS_MAC:
            return _MacInput()
        if IS_LINUX:
            if is_wayland():
                s = InputState()
                s.reason = "Wayland doesn't let apps watch the mouse, so use the drop dock."
                return s
            return _X11Input()
    except Exception as e:  # noqa: BLE001
        s = InputState()
        s.reason = f"Global input unavailable: {e}"
        return s
    return InputState()


# ====================================================================== windows & files

def bring_to_front(w):
    w.show()
    w.raise_()
    if IS_WIN:
        # Windows blocks background apps from stealing focus; borrow the foreground thread's input.
        from ctypes import wintypes
        u, k = ctypes.windll.user32, ctypes.windll.kernel32
        u.GetForegroundWindow.restype = wintypes.HWND
        u.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.c_void_p]
        u.SetForegroundWindow.argtypes = [wintypes.HWND]
        u.BringWindowToTop.argtypes = [wintypes.HWND]
        hwnd = int(w.winId())
        fg_thread = u.GetWindowThreadProcessId(u.GetForegroundWindow(), None)
        me = k.GetCurrentThreadId()
        attached = fg_thread and fg_thread != me and u.AttachThreadInput(fg_thread, me, True)
        u.SetForegroundWindow(hwnd)
        u.BringWindowToTop(hwnd)
        if attached:
            u.AttachThreadInput(fg_thread, me, False)
    w.activateWindow()


def reveal(path: Path):
    """Show a file selected in the file manager."""
    path = Path(path)
    if IS_WIN:
        subprocess.Popen(["explorer", "/select,", str(path)])
    elif IS_MAC:
        subprocess.Popen(["open", "-R", str(path)])
    else:
        uri = path.resolve().as_uri()
        try:
            subprocess.run(["gdbus", "call", "--session", "--dest", "org.freedesktop.FileManager1",
                            "--object-path", "/org/freedesktop/FileManager1",
                            "--method", "org.freedesktop.FileManager1.ShowItems", f"['{uri}']", ""],
                           check=True, capture_output=True, timeout=3)
        except Exception:  # noqa: BLE001
            open_folder(path.parent)


def open_folder(path: Path):
    if IS_WIN:
        os.startfile(path)  # noqa: S606
    elif IS_MAC:
        subprocess.Popen(["open", str(path)])
    else:
        subprocess.Popen(["xdg-open", str(path)])


# ====================================================================== start at login

def _exe_args() -> list[str]:
    if getattr(sys, "frozen", False):
        return [os.environ.get("APPIMAGE") or sys.executable]
    script = Path(__file__).resolve().parent.parent / "ShiftDrop.pyw"
    py = sys.executable
    if IS_WIN:
        pyw = Path(py).with_name("pythonw.exe")
        py = str(pyw) if pyw.exists() else py
    return [py, str(script)]


_WIN_RUN = r"Software\Microsoft\Windows\CurrentVersion\Run"
_MAC_AGENT = Path.home() / "Library" / "LaunchAgents" / "in.devindi.shiftdrop.plist"
_XDG_AUTOSTART = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "autostart" / "shiftdrop.desktop"


def autostart_enabled() -> bool:
    if IS_WIN:
        import winreg
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _WIN_RUN) as k:
                winreg.QueryValueEx(k, APP_NAME)
                return True
        except OSError:
            return False
    if IS_MAC:
        return _MAC_AGENT.exists()
    return _XDG_AUTOSTART.exists()


def set_autostart(on: bool):
    args = _exe_args() + ["--quiet"]
    if IS_WIN:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _WIN_RUN, 0, winreg.KEY_SET_VALUE) as k:
            if on:
                winreg.SetValueEx(k, APP_NAME, 0, winreg.REG_SZ, " ".join(f'"{a}"' if " " in a else a for a in args))
            else:
                try:
                    winreg.DeleteValue(k, APP_NAME)
                except FileNotFoundError:
                    pass
    elif IS_MAC:
        if on:
            import plistlib
            _MAC_AGENT.parent.mkdir(parents=True, exist_ok=True)
            with open(_MAC_AGENT, "wb") as f:
                plistlib.dump({"Label": "in.devindi.shiftdrop", "ProgramArguments": args,
                               "RunAtLoad": True, "ProcessType": "Interactive"}, f)
        else:
            _MAC_AGENT.unlink(missing_ok=True)
    else:
        if on:
            _XDG_AUTOSTART.parent.mkdir(parents=True, exist_ok=True)
            _XDG_AUTOSTART.write_text(desktop_entry(args), encoding="utf-8")
        else:
            _XDG_AUTOSTART.unlink(missing_ok=True)


# ====================================================================== Linux menu entry

_APPS_DIR = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share")) / "applications"
_ICON_PATH = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share")) / "icons" / "hicolor" \
    / "256x256" / "apps" / "shiftdrop.png"


def _quote(a: str) -> str:
    return f'"{a}"' if " " in a else a


def desktop_entry(args: list[str]) -> str:
    return ("[Desktop Entry]\nType=Application\nName=ShiftDrop\n"
            "Comment=Drag files, press Shift, drop to convert\n"
            f"Exec={' '.join(_quote(a) for a in args)}\nIcon=shiftdrop\nTerminal=false\n"
            "Categories=Utility;Graphics;Office;\nStartupNotify=false\n")


def linux_menu_installed() -> bool:
    return (_APPS_DIR / "shiftdrop.desktop").exists()


def install_linux_menu_entry(icon_png: bytes):
    _APPS_DIR.mkdir(parents=True, exist_ok=True)
    _ICON_PATH.parent.mkdir(parents=True, exist_ok=True)
    _ICON_PATH.write_bytes(icon_png)
    (_APPS_DIR / "shiftdrop.desktop").write_text(desktop_entry(_exe_args()), encoding="utf-8")


def remove_linux_menu_entry():
    (_APPS_DIR / "shiftdrop.desktop").unlink(missing_ok=True)
    _ICON_PATH.unlink(missing_ok=True)
