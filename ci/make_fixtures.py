"""Create one sample file of each supported type for the packaged-build self-test."""
import sys
from pathlib import Path

import pymupdf
from docx import Document
from PIL import Image, ImageDraw

out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)

img = Image.new("RGB", (800, 600), (239, 74, 42))
ImageDraw.Draw(img).text((40, 40), "ShiftDrop self-test", fill="white")
img.save(out / "shot.jpg", quality=90)
img.convert("RGBA").save(out / "photo.png")

doc = pymupdf.open()
for i in range(2):
    doc.new_page().insert_text((72, 72), f"Page {i + 1} text")
doc.save(out / "Page 001.pdf")

(out / "notes.txt").write_text("Hello\n\nThis is a test line.\n" * 40, encoding="utf-8")

d = Document()
d.add_paragraph("Hello from a Word document.")
d.save(out / "notes.docx")
print("fixtures in", out)
