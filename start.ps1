# StockAssistant 股票智能助手 - PowerShell 一键启动脚本
$Host.UI.RawUI.WindowTitle = "StockAssistant 股票智能助手 - 一键启动器"

Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "       StockAssistant 股票智能助手 一键启动" -ForegroundColor Cyan
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host ""

$WorkDir = $PSScriptRoot

# 1. 检查 Python 环境
Write-Host "[1/3] 检查后端运行环境..." -ForegroundColor Yellow
$PythonCmd = "python"
if (Test-Path "$WorkDir\backend\venv\Scripts\python.exe") {
    Write-Host "[*] 检测到 backend\venv 虚拟环境" -ForegroundColor Green
    $PythonCmd = "$WorkDir\backend\venv\Scripts\python.exe"
} elseif (Test-Path "$WorkDir\backend\.venv\Scripts\python.exe") {
    Write-Host "[*] 检测到 backend\.venv 虚拟环境" -ForegroundColor Green
    $PythonCmd = "$WorkDir\backend\.venv\Scripts\python.exe"
} elseif (Test-Path "$WorkDir\venv\Scripts\python.exe") {
    Write-Host "[*] 检测到根目录 venv 虚拟环境" -ForegroundColor Green
    $PythonCmd = "$WorkDir\venv\Scripts\python.exe"
} else {
    Write-Host "[*] 使用系统全局 Python" -ForegroundColor Gray
}

# 2. 检查前端依赖
Write-Host "[2/3] 检查前端运行环境..." -ForegroundColor Yellow
if (-not (Test-Path "$WorkDir\frontend\node_modules")) {
    Write-Host "[!] 未检测到 node_modules，开始自动安装前端依赖..." -ForegroundColor Red
    Set-Location "$WorkDir\frontend"
    npm install
    Set-Location $WorkDir
}

# 3. 启动前后端服务
Write-Host "[3/3] 正在启动前后端服务..." -ForegroundColor Yellow

# 启动后端
Start-Process cmd.exe -ArgumentList "/k", "cd /d `"$WorkDir\backend`" & `"$PythonCmd`" main.py" -WorkingDirectory "$WorkDir\backend"

# 启动前端
Start-Process cmd.exe -ArgumentList "/k", "cd /d `"$WorkDir\frontend`" & npm run dev" -WorkingDirectory "$WorkDir\frontend"

Write-Host ""
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host " 服务启动指令已发送！" -ForegroundColor Green
Write-Host ""
Write-Host " - 前端界面: http://localhost:5173" -ForegroundColor White
Write-Host " - 后端 API: http://127.0.0.1:8000" -ForegroundColor White
Write-Host " - API 文档: http://127.0.0.1:8000/docs" -ForegroundColor White
Write-Host ""
Write-Host " 提示: 独立打开的命令行窗口用于显示前后端日志，" -ForegroundColor Gray
Write-Host "       如需停止服务，直接关闭对应的命令行窗口即可。" -ForegroundColor Gray
Write-Host "===================================================" -ForegroundColor Cyan

Start-Sleep -Seconds 3
Start-Process "http://localhost:5173"
