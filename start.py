#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
StockAssistant 股票智能助手 - Python 一键启动脚本
支持 Windows / macOS / Linux
"""

import os
import sys
import subprocess
import time
import webbrowser
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent

def main():
    print("=" * 55)
    print("       StockAssistant 股票智能助手 一键启动器")
    print("=" * 55)
    print()

    backend_dir = ROOT_DIR / "backend"
    frontend_dir = ROOT_DIR / "frontend"

    # 1. 检测 Python 可执行文件
    python_cmd = sys.executable
    venv_candidates = [
        backend_dir / "venv" / "Scripts" / "python.exe",
        backend_dir / ".venv" / "Scripts" / "python.exe",
        ROOT_DIR / "venv" / "Scripts" / "python.exe",
        backend_dir / "venv" / "bin" / "python",
        backend_dir / ".venv" / "bin" / "python",
    ]
    for venv_py in venv_candidates:
        if venv_py.exists():
            python_cmd = str(venv_py)
            print(f"[*] 检测到虚拟环境: {python_cmd}")
            break
    else:
        print(f"[*] 使用 Python 环境: {python_cmd}")

    # 2. 检查前端依赖
    if not (frontend_dir / "node_modules").exists():
        print("[!] 未检测到 node_modules，正在自动安装前端依赖...")
        subprocess.run(["npm", "install"], cwd=frontend_dir, shell=True)

    # 3. 启动前后端服务
    print("[*] 正在启动后端服务 (FastAPI - http://127.0.0.1:8000)...")
    if sys.platform == "win32":
        subprocess.Popen(
            f'start "StockAssistant - Backend" /D "{backend_dir}" cmd /k "{python_cmd}" main.py',
            shell=True
        )
    else:
        subprocess.Popen([python_cmd, "main.py"], cwd=backend_dir)

    print("[*] 正在启动前端服务 (Vite - http://localhost:5173)...")
    if sys.platform == "win32":
        subprocess.Popen(
            f'start "StockAssistant - Frontend" /D "{frontend_dir}" cmd /k npm run dev',
            shell=True
        )
    else:
        subprocess.Popen(["npm", "run", "dev"], cwd=frontend_dir)

    print()
    print("===================================================")
    print(" 服务已成功开启！")
    print(" - 前端界面: http://localhost:5173")
    print(" - 后端 API: http://127.0.0.1:8000")
    print(" - API 文档: http://127.0.0.1:8000/docs")
    print("===================================================")

    # 3秒后自动打开浏览器
    time.sleep(3)
    webbrowser.open("http://localhost:5173")

if __name__ == "__main__":
    main()
