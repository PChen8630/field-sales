@echo off
REM Starts Field Sales Command Center on this computer only and opens it in your browser.
REM Keep this window open while you use the app. Always use this launcher: your data is tied to this address.
cd /d "%~dp0"
start "" http://localhost:8765/
python -m http.server 8765 --bind 127.0.0.1
