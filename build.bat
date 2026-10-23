@echo off
rem Builds dist\ShiftDrop.exe (the app) and release\ShiftDrop-Setup.exe (the installer).
cd /d "%~dp0"
python -m pip install -r requirements.txt pyinstaller || exit /b 1
taskkill /F /IM ShiftDrop.exe >nul 2>&1
python -m PyInstaller --noconfirm ShiftDrop.spec || exit /b 1
python -m PyInstaller --noconfirm --onefile --windowed --name ShiftDrop-Setup --distpath release --workpath build/setup --specpath build --icon ../assets/ShiftDrop.ico --add-data "../dist/ShiftDrop.exe;." --add-data "../assets/icon.png;assets" --add-data "../assets/ShiftDrop.ico;assets" --paths . --exclude-module PySide6 --exclude-module numpy --exclude-module PIL installer/setup_main.py || exit /b 1
echo.
echo Built release\ShiftDrop-Setup.exe
