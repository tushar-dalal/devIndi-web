"""ShiftDrop-Setup.exe: a small wizard that installs the bundled ShiftDrop.exe for the current user.

Silent use:  ShiftDrop-Setup.exe --silent [--dir PATH] [--no-desktop] [--startup] [--launch]
"""
import os
import subprocess
import sys
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from shiftdrop import install  # noqa: E402

ACCENT = "#ef4a2a"
BG = "#fff4ec"
TEXT = "#4a2a1c"
MUTED = "#8a5a44"


def resource(name: str) -> Path:
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent.parent))
    return base / name


def payload() -> Path:
    for cand in (resource("ShiftDrop.exe"), resource("dist/ShiftDrop.exe")):
        if cand.exists():
            return cand
    raise FileNotFoundError("ShiftDrop.exe payload missing from installer")


def launch(exe: Path):
    subprocess.Popen([str(exe)], cwd=str(exe.parent), creationflags=0x00000008, close_fds=True)


def run_silent(argv: list[str]) -> int:
    folder = Path(argv[argv.index("--dir") + 1]) if "--dir" in argv else install.default_dir()
    exe = install.install(payload(), folder, desktop="--no-desktop" not in argv, startup="--startup" in argv)
    if "--launch" in argv:
        launch(exe)
    return 0


class Wizard(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("ShiftDrop Setup")
        self.configure(bg=BG)
        self.resizable(False, False)
        try:
            self.iconbitmap(str(resource("assets/ShiftDrop.ico")))
        except tk.TclError:
            pass
        w, h = 520, 400
        self.geometry(f"{w}x{h}+{(self.winfo_screenwidth() - w) // 2}+{(self.winfo_screenheight() - h) // 3}")

        style = ttk.Style(self)
        style.theme_use("clam")
        style.configure("TCheckbutton", background=BG, foreground=TEXT, font=("Segoe UI", 10))
        style.map("TCheckbutton", background=[("active", BG)])
        style.configure("Accent.TButton", background=ACCENT, foreground="white", font=("Segoe UI", 10, "bold"),
                        borderwidth=0, padding=(18, 7))
        style.map("Accent.TButton", background=[("active", "#d93e20"), ("disabled", "#f3b3a3")])
        style.configure("Plain.TButton", background="#fde3d3", foreground=TEXT, font=("Segoe UI", 10),
                        borderwidth=0, padding=(14, 7))
        style.map("Plain.TButton", background=[("active", "#fbd3bb")])
        style.configure("Horizontal.TProgressbar", troughcolor="#f3d2c0", background=ACCENT, borderwidth=0,
                        lightcolor=ACCENT, darkcolor=ACCENT)

        self.folder = tk.StringVar(value=str(install.installed_dir() or install.default_dir()))
        self.desktop = tk.BooleanVar(value=True)
        self.startup = tk.BooleanVar(value=True)
        self.launch_after = tk.BooleanVar(value=True)
        self.exe = None

        self.body = tk.Frame(self, bg=BG)
        self.body.pack(fill="both", expand=True, padx=28, pady=22)
        self.page_options()

    def clear(self):
        for c in self.body.winfo_children():
            c.destroy()

    def header(self, title: str, sub: str):
        top = tk.Frame(self.body, bg=BG)
        top.pack(fill="x")
        try:
            self._logo = tk.PhotoImage(file=str(resource("assets/icon.png"))).subsample(4, 4)
            tk.Label(top, image=self._logo, bg=BG).pack(side="left", padx=(0, 14))
        except tk.TclError:
            pass
        txt = tk.Frame(top, bg=BG)
        txt.pack(side="left", fill="x")
        tk.Label(txt, text=title, bg=BG, fg=TEXT, font=("Segoe UI", 16, "bold")).pack(anchor="w")
        tk.Label(txt, text=sub, bg=BG, fg=MUTED, font=("Segoe UI", 10), justify="left",
                 wraplength=380).pack(anchor="w")

    def page_options(self):
        self.clear()
        upgrading = install.installed_dir() is not None
        self.header(f"ShiftDrop {install.VERSION}",
                    "Drag files in Explorer, press Shift, and drop them on the wheel to convert or edit them.")
        tk.Label(self.body, text="Install to", bg=BG, fg=MUTED, font=("Segoe UI", 9)).pack(anchor="w", pady=(22, 2))
        row = tk.Frame(self.body, bg=BG)
        row.pack(fill="x")
        tk.Entry(row, textvariable=self.folder, font=("Segoe UI", 10), relief="solid", bd=1,
                 fg=TEXT).pack(side="left", fill="x", expand=True, ipady=4)
        ttk.Button(row, text="Browse…", style="Plain.TButton", command=self.browse).pack(side="left", padx=(8, 0))

        opts = tk.Frame(self.body, bg=BG)
        opts.pack(fill="x", pady=(16, 0))
        ttk.Checkbutton(opts, text="Create a Desktop shortcut", variable=self.desktop).pack(anchor="w", pady=2)
        ttk.Checkbutton(opts, text="Start ShiftDrop when Windows starts", variable=self.startup).pack(anchor="w", pady=2)
        ttk.Checkbutton(opts, text="Launch ShiftDrop when setup finishes", variable=self.launch_after).pack(anchor="w", pady=2)

        bottom = tk.Frame(self.body, bg=BG)
        bottom.pack(side="bottom", fill="x")
        tk.Label(self.body, text="No admin rights needed · installs for your account only", bg=BG, fg=MUTED,
                 font=("Segoe UI", 8)).pack(side="bottom", anchor="w", pady=(0, 10))
        ttk.Button(bottom, text="Update" if upgrading else "Install", style="Accent.TButton",
                   command=self.page_progress).pack(side="right")
        ttk.Button(bottom, text="Cancel", style="Plain.TButton", command=self.destroy).pack(side="right", padx=8)

    def browse(self):
        d = filedialog.askdirectory(initialdir=self.folder.get(), title="Choose install folder")
        if d:
            p = Path(d)
            self.folder.set(str(p if p.name.lower() == "shiftdrop" else p / "ShiftDrop"))

    def page_progress(self):
        self.clear()
        self.header("Installing…", "Copying ShiftDrop and creating shortcuts.")
        self.bar = ttk.Progressbar(self.body, mode="indeterminate", length=460)
        self.bar.pack(pady=(50, 0))
        self.bar.start(12)
        threading.Thread(target=self._do_install, daemon=True).start()

    def _do_install(self):
        try:
            self.exe = install.install(payload(), Path(self.folder.get()), self.desktop.get(), self.startup.get())
            self.after(0, self.page_done)
        except Exception as e:  # noqa: BLE001
            self.after(0, lambda: self.page_error(e))

    def page_error(self, e):
        messagebox.showerror("ShiftDrop Setup", f"Setup couldn't finish:\n\n{e}")
        self.page_options()

    def page_done(self):
        self.clear()
        self.header("ShiftDrop is installed",
                    "Find it in the Start menu. It runs from the system tray (bottom-right, near the clock).")
        steps = ("1.  Start dragging a file in Explorer or on the Desktop\n"
                 "2.  Keep holding the mouse and press Shift\n"
                 "3.  Drop it on a format, or press Shift again for tools\n\n"
                 "Uninstall anytime from Settings → Apps → ShiftDrop.")
        tk.Label(self.body, text=steps, bg=BG, fg=TEXT, font=("Segoe UI", 10), justify="left").pack(anchor="w",
                                                                                                    pady=(26, 0))
        bottom = tk.Frame(self.body, bg=BG)
        bottom.pack(side="bottom", fill="x")
        ttk.Button(bottom, text="Finish", style="Accent.TButton", command=self.finish).pack(side="right")

    def finish(self):
        if self.launch_after.get() and self.exe:
            launch(self.exe)
        self.destroy()


def main() -> int:
    if "--silent" in sys.argv:
        return run_silent(sys.argv)
    Wizard().mainloop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
