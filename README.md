# ShiftDrop for Windows

Drag files, press **Shift**, drop them on the wheel to convert or edit them. This is a Windows version of the macOS "drag + shift" converter.

## Use
1. Start dragging one or more files in Explorer or on the Desktop.
2. While you're still holding the mouse button, press **Shift**. The wheel opens under the cursor.
3. Press **Shift** again to switch between **Convert** and **Tools**.
4. Drop on a slice. Drop in the centre to cancel. Results are saved next to the original
   (`Page 001.jpg`, `Page 001 Cropped.jpg`, `Page 001 With Background.png`, …). Click the toast to show the file in Explorer.

| Dragged | Convert | Tools |
|---|---|---|
| Image (PNG, JPG, WEBP, HEIC, AVIF, TIFF, BMP, GIF) | PNG, JPG, WEBP, HEIC, TIFF, AVIF, BMP, PDF, DOCX | Compress, Metadata, Edit, Annotate, Add BG, Crop, Redact |
| PDF | DOCX, JPG, PNG, TXT | Compress, Metadata |
| TXT / MD / CSV | PDF, DOCX | – |
| DOCX | PDF (text only), TXT | – |
| Several images/PDFs | common formats | Compress, Clean Meta, Merge PDF |

The tray icon has options for Enabled, *Only when dragging from Explorer/Desktop*, and *Start with Windows*, plus Quit.

## Run
```
pip install -r requirements.txt
pythonw ShiftDrop.pyw
```
Optional: run `build.bat` to make a standalone `dist\ShiftDrop\ShiftDrop.exe`.
Log file: `%LOCALAPPDATA%\ShiftDrop\shiftdrop.log`.

## Licence
ShiftDrop is released under the GNU Affero General Public License v3.0 (see `LICENSE`).
It bundles PyMuPDF (AGPL-3.0), Qt for Python / PySide6 (LGPL-3.0), pdf2docx and python-docx (MIT),
Pillow (MIT-CMU), pillow-heif (BSD-3-Clause, with libheif LGPL-3.0 and x265 GPL-2.0),
OpenCV (Apache-2.0), NumPy and lxml (BSD).
