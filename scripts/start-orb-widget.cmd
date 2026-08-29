@echo off
rem Always-on-top DSH Agent Presence ball (no console window).
rem PowerShell 5.1 runs STA by default, which WinForms needs.
powershell.exe -NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0orb-widget.ps1"
