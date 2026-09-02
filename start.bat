@echo off
chcp 65001 >nul
title StockAssistant 股票智能助手 - 一键启动器

echo ===================================================
echo        StockAssistant 股票智能助手 一键启动
echo ===================================================
echo.

set "WORK_DIR=%~dp0"
cd /d "%WORK_DIR%"

:: 1. 检查 Backend 环境
echo [1/3] 检查后端运行环境...
set "PYTHON_CMD=python"

if exist "backend\venv\Scripts\python.exe" (
    echo [*] 检测到 backend\venv 虚拟环境
    set "PYTHON_CMD=%WORK_DIR%backend\venv\Scripts\python.exe"
) else if exist "backend\.venv\Scripts\python.exe" (
    echo [*] 检测到 backend\.venv 虚拟环境
    set "PYTHON_CMD=%WORK_DIR%backend\.venv\Scripts\python.exe"
) else if exist "venv\Scripts\python.exe" (
    echo [*] 检测到根目录 venv 虚拟环境
    set "PYTHON_CMD=%WORK_DIR%venv\Scripts\python.exe"
) else (
    echo [*] 未检测到虚拟环境，将使用系统全局 Python。
)

:: 2. 检查 Frontend 环境
echo [2/3] 检查前端运行环境...
if not exist "frontend\node_modules\" (
    echo [!] 未检测到 frontend\node_modules，正在自动安装前端依赖...
    cd /d "%WORK_DIR%frontend"
    call npm install
    cd /d "%WORK_DIR%"
)

:: 3. 启动后端与前端服务
echo [3/3] 正在启动前后端服务...
echo.

:: 启动后端
echo [*] 启动后端服务 (FastAPI - http://127.0.0.1:8000)...
start "StockAssistant - Backend" /D "%WORK_DIR%backend" "%PYTHON_CMD%" main.py

:: 启动前端
echo [*] 启动前端服务 (Vite - http://localhost:5173)...
start "StockAssistant - Frontend" /D "%WORK_DIR%frontend" npm run dev

echo.
echo ===================================================
echo  服务已成功开启！
echo.
echo  - 前端界面: http://localhost:5173
echo  - 后端 API: http://127.0.0.1:8000
echo  - API 文档: http://127.0.0.1:8000/docs
echo.
echo  提示: 独立打开的命令行窗口用于显示前后端日志，
echo        如需停止服务，直接关闭对应的命令行窗口即可。
echo ===================================================
echo.

:: 3秒后自动在浏览器中打开前端页面
timeout /t 3 /nobreak >nul
start http://localhost:5173

pause
