@echo off
setlocal
title Pocket Claude - install
set "VSIX=%~dp0pocket-claude-executor.vsix"
if not exist "%VSIX%" (
  echo pocket-claude-executor.vsix must be in the same folder as this file.
  pause
  exit /b 1
)
set "CODE="
if exist "%LOCALAPPDATA%\Programs\Microsoft VS Code\bin\code.cmd" set "CODE=%LOCALAPPDATA%\Programs\Microsoft VS Code\bin\code.cmd"
if not defined CODE if exist "%ProgramFiles%\Microsoft VS Code\bin\code.cmd" set "CODE=%ProgramFiles%\Microsoft VS Code\bin\code.cmd"
if not defined CODE if exist "%ProgramFiles(x86)%\Microsoft VS Code\bin\code.cmd" set "CODE=%ProgramFiles(x86)%\Microsoft VS Code\bin\code.cmd"
if not defined CODE for /f "delims=" %%i in ('where code.cmd 2^>nul') do if not defined CODE set "CODE=%%i"
if not defined CODE (
  echo VS Code was not found. Install it from https://code.visualstudio.com and run this file again,
  echo or in VS Code open Extensions, click ... and choose "Install from VSIX".
  pause
  exit /b 1
)
echo Installing Pocket Claude into VS Code...
echo   using %CODE%
call "%CODE%" --install-extension "%VSIX%" --force
if errorlevel 1 (
  echo Installation failed. In VS Code open Extensions, click ... and choose "Install from VSIX".
  pause
  exit /b 1
)
echo.
echo Done. Restart VS Code, then:
echo   1. On the phone: open the Lipton chat, tap the phone icon, then "Add a computer".
echo   2. In VS Code open your project folder, press Ctrl+Shift+P, run "Pocket Claude: Pair with Mac".
echo   3. Press Enter on the address, type the code from the phone, check the safety number matches.
echo.
pause
