@echo off
rem Wavenum launcher - Kishan Tiwari <kishantiwari@iitkgp.ac.in>
cd /d "%~dp0"
start "" http://127.0.0.1:8765
.venv\Scripts\python backend\main.py
