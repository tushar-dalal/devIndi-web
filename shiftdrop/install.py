"""Install / uninstall helpers shared by the setup program and `ShiftDrop.exe --uninstall`.

Per-user install (no admin rights): files in %LOCALAPPDATA%\\Programs\\ShiftDrop, an entry in
Settings > Apps, Start Menu / Desktop shortcuts and an optional "start with Windows" Run key.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import winreg
from pathlib import Path

APP_NAME = "ShiftDrop"
VERSION = "1.1.0"
PUBLISHER = "Tushar Dalal"
EXE_NAME = "ShiftDrop.exe"
UNINSTALL_KEY = rf"Software\Microsoft\Windows\CurrentVersion\Uninstall\{APP_NAME}"
RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
SETTINGS_KEY = rf"Software\{APP_NAME}"
NO_WINDOW = 0x08000000


def default_dir() -> Path:
    return Path(os.environ["LOCALAPPDATA"]) / "Programs" / APP_NAME


def installed_dir() -> Path | None:
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, UNINSTALL_KEY) as k:
            return Path(winreg.QueryValueEx(k, "InstallLocation")[0])
    except OSError:
        return None


def _ps(script: str):
    subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
                   creationflags=NO_WINDOW, check=False)


def _shortcut_dirs() -> tuple[Path, str]:
    start_menu = Path(os.environ["APPDATA"]) / "Microsoft" / "Windows" / "Start Menu" / "Programs"
    return start_menu, "([Environment]::GetFolderPath('Desktop'))"


def _q(path) -> str:
    """Quote a path as a PowerShell single-quoted string."""
    return "'" + str(path).replace("'", "''") + "'"


def create_shortcut(target: Path, desktop: bool):
    start_menu, desktop_expr = _shortcut_dirs()
    lines = ["$w = New-Object -ComObject WScript.Shell"]
    places = [_q(start_menu / f"{APP_NAME}.lnk")]
    if desktop:
        places.append(f"(Join-Path {desktop_expr} '{APP_NAME}.lnk')")
    for place in places:
        lines.append(f"$s = $w.CreateShortcut({place}); $s.TargetPath = {_q(target)}; "
                     f"$s.WorkingDirectory = {_q(target.parent)}; $s.IconLocation = {_q(f'{target},0')}; "
                     f"$s.Description = 'Drag files + Shift to convert them'; $s.Save()")
    _ps("; ".join(lines))


def remove_shortcuts():
    start_menu, desktop_expr = _shortcut_dirs()
    (start_menu / f"{APP_NAME}.lnk").unlink(missing_ok=True)
    _ps(f"Remove-Item -ErrorAction SilentlyContinue (Join-Path {desktop_expr} '{APP_NAME}.lnk')")


def set_startup(exe: Path | None):
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as k:
        if exe:
            winreg.SetValueEx(k, APP_NAME, 0, winreg.REG_SZ, f'"{exe}"')
        else:
            try:
                winreg.DeleteValue(k, APP_NAME)
            except FileNotFoundError:
                pass


def write_uninstall_entry(folder: Path, exe: Path):
    size_kb = sum(f.stat().st_size for f in folder.rglob("*") if f.is_file()) // 1024
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, UNINSTALL_KEY) as k:
        for name, val in (("DisplayName", APP_NAME), ("DisplayVersion", VERSION), ("Publisher", PUBLISHER),
                          ("DisplayIcon", f"{exe},0"), ("InstallLocation", str(folder)),
                          ("UninstallString", f'"{exe}" --uninstall'),
                          ("QuietUninstallString", f'"{exe}" --uninstall --silent')):
            winreg.SetValueEx(k, name, 0, winreg.REG_SZ, val)
        winreg.SetValueEx(k, "EstimatedSize", 0, winreg.REG_DWORD, size_kb)
        winreg.SetValueEx(k, "NoModify", 0, winreg.REG_DWORD, 1)
        winreg.SetValueEx(k, "NoRepair", 0, winreg.REG_DWORD, 1)


def stop_running(exclude_self: bool = False):
    """Close any running ShiftDrop so its exe can be replaced or removed."""
    cmd = ["taskkill", "/F", "/IM", EXE_NAME]
    if exclude_self:  # a one-file exe runs as a launcher + child: spare both
        cmd += ["/FI", f"PID ne {os.getpid()}", "/FI", f"PID ne {os.getppid()}"]
    subprocess.run(cmd, creationflags=NO_WINDOW, capture_output=True, check=False)


def install(payload: Path, folder: Path, desktop: bool, startup: bool) -> Path:
    stop_running()
    folder.mkdir(parents=True, exist_ok=True)
    exe = folder / EXE_NAME
    shutil.copy2(payload, exe)
    create_shortcut(exe, desktop)
    set_startup(exe if startup else None)
    write_uninstall_entry(folder, exe)
    return exe


def uninstall(folder: Path | None = None, delete_self: bool = True):
    folder = folder or installed_dir()
    stop_running(exclude_self=True)
    set_startup(None)
    remove_shortcuts()
    for key in (UNINSTALL_KEY, rf"{SETTINGS_KEY}\{APP_NAME}", SETTINGS_KEY):
        try:
            winreg.DeleteKey(winreg.HKEY_CURRENT_USER, key)
        except OSError:
            pass
    shutil.rmtree(Path(os.environ["LOCALAPPDATA"]) / APP_NAME, ignore_errors=True)  # logs
    if folder and folder.exists():
        if delete_self:
            # Our own exe is locked while we run: keep retrying the delete for a while after we exit.
            # It must break away from the one-file launcher's job object, or it dies when we exit.
            os.chdir(folder.parent)
            cmd = (f'cmd /c for /l %i in (1,1,20) do (ping 127.0.0.1 -n 2 > nul & '
                   f'rmdir /s /q "{folder}" 2> nul & if not exist "{folder}" exit /b)')
            # (cmd needs a console, so CREATE_NO_WINDOW rather than DETACHED_PROCESS.)
            try:
                subprocess.Popen(cmd, cwd=str(folder.parent), close_fds=True,
                                 creationflags=NO_WINDOW | 0x01000000)  # CREATE_BREAKAWAY_FROM_JOB
            except OSError:
                subprocess.Popen(cmd, cwd=str(folder.parent), close_fds=True, creationflags=NO_WINDOW)
        else:
            shutil.rmtree(folder, ignore_errors=True)
