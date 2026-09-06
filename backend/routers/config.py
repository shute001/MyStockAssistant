from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
from database import get_db, LLMConfig, PushConfig
from services.notifier import send_wechat_notification
import httpx

router = APIRouter(prefix="/config", tags=["LLM & Push Configs"])

class ConfigSaveRequest(BaseModel):
    provider_name: str  # deepseek, kimi, qwen, custom
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    selected_model: Optional[str] = None
    set_active: bool = True

class TestConnectionRequest(BaseModel):
    provider_name: str
    api_key: str
    base_url: Optional[str] = None
    model: Optional[str] = None

class PushConfigSaveRequest(BaseModel):
    channel: str  # serverchan, pushplus, wechat_work
    secret_key: Optional[str] = None
    is_enabled: bool = True
    auto_push_review: bool = False

class TestPushRequest(BaseModel):
    channel: str
    secret_key: str

@router.get("/push")
def get_push_config(db: Session = Depends(get_db)):
    """Get current WeChat push config"""
    cfg = db.query(PushConfig).first()
    if not cfg:
        return {
            "channel": "serverchan",
            "has_key": False,
            "secret_key_masked": "",
            "is_enabled": False,
            "auto_push_review": False
        }
    
    masked = f"{cfg.secret_key[:4]}...{cfg.secret_key[-4:]}" if cfg.secret_key and len(cfg.secret_key) > 8 else ("已配置" if cfg.secret_key else "")
    return {
        "id": cfg.id,
        "channel": cfg.channel,
        "has_key": bool(cfg.secret_key),
        "secret_key_masked": masked,
        "is_enabled": cfg.is_enabled,
        "auto_push_review": cfg.auto_push_review
    }

@router.post("/push")
def save_push_config(req: PushConfigSaveRequest, db: Session = Depends(get_db)):
    """Save WeChat push config"""
    cfg = db.query(PushConfig).first()
    if not cfg:
        cfg = PushConfig(
            channel=req.channel,
            secret_key=req.secret_key,
            is_enabled=req.is_enabled,
            auto_push_review=req.auto_push_review
        )
        db.add(cfg)
    else:
        cfg.channel = req.channel
        if req.secret_key is not None and req.secret_key.strip() != "":
            cfg.secret_key = req.secret_key.strip()
        cfg.is_enabled = req.is_enabled
        cfg.auto_push_review = req.auto_push_review

    db.commit()
    db.refresh(cfg)
    return {"status": "success", "channel": cfg.channel, "is_enabled": cfg.is_enabled}

@router.post("/push/test")
async def test_push_notification(req: TestPushRequest):
    """Test sending a test message to WeChat"""
    res = await send_wechat_notification(
        title="🤖 AI炒股助手 - 微信推送测试",
        content_md="恭喜！您的 AI 炒股助手微信推送通道连接正常！后续复盘报告及交易预警将实时推送至您的微信。",
        channel=req.channel,
        secret_key=req.secret_key
    )
    return res


@router.get("/llm")
def get_llm_configs(db: Session = Depends(get_db)):
    """List all configured LLM providers"""
    configs = db.query(LLMConfig).all()
    # Mask API keys in public listing for security
    result = []
    for cfg in configs:
        masked_key = f"{cfg.api_key[:4]}...{cfg.api_key[-4:]}" if cfg.api_key and len(cfg.api_key) > 8 else ("已设置" if cfg.api_key else "")
        result.append({
            "id": cfg.id,
            "provider_name": cfg.provider_name,
            "api_key_masked": masked_key,
            "has_key": bool(cfg.api_key),
            "base_url": cfg.base_url,
            "selected_model": cfg.selected_model,
            "is_active": cfg.is_active
        })
    return result

@router.post("/llm")
def save_llm_config(req: ConfigSaveRequest, db: Session = Depends(get_db)):
    """Save or update API Key and endpoint for a provider"""
    provider = req.provider_name.lower().strip()
    
    if req.set_active:
        # Reset current active flags
        db.query(LLMConfig).update({"is_active": False})

    cfg = db.query(LLMConfig).filter(LLMConfig.provider_name == provider).first()
    if not cfg:
        cfg = LLMConfig(
            provider_name=provider,
            api_key=req.api_key,
            base_url=req.base_url,
            selected_model=req.selected_model or "deepseek-chat",
            is_active=req.set_active
        )
        db.add(cfg)
    else:
        if req.api_key is not None:
            cfg.api_key = req.api_key
        if req.base_url is not None:
            cfg.base_url = req.base_url
        if req.selected_model is not None:
            cfg.selected_model = req.selected_model
        if req.set_active:
            cfg.is_active = True

    db.commit()
    db.refresh(cfg)
    return {"status": "success", "provider_name": provider, "is_active": cfg.is_active}

@router.post("/test-connection")
async def test_connection(req: TestConnectionRequest):
    """Test LLM API Key connection"""
    if not req.api_key:
        raise HTTPException(status_code=400, detail="API Key cannot be empty")
    
    base_url = req.base_url or "https://api.deepseek.com"
    model = req.model or "deepseek-chat"
    url = f"{base_url.rstrip('/')}/chat/completions"

    headers = {
        "Authorization": f"Bearer {req.api_key}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": "Hi"}],
        "max_tokens": 5
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.post(url, headers=headers, json=payload)
            if res.status_code == 200:
                return {"status": "success", "message": "Connection test passed!"}
            else:
                return {"status": "failed", "code": res.status_code, "detail": res.text}
    except Exception as e:
        return {"status": "failed", "detail": str(e)}

import os
from datetime import datetime
from fastapi import UploadFile, File
from fastapi.responses import FileResponse
from config import settings

@router.get("/db/backup")
def backup_database():
    """Download SQLite database backup file"""
    db_path = settings.DATABASE_URL.replace("sqlite:///", "")
    if not os.path.isabs(db_path):
        db_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), db_path)

    if not os.path.exists(db_path):
        raise HTTPException(status_code=404, detail="Database file not found")

    filename = f"stock_assistant_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.db"
    return FileResponse(path=db_path, filename=filename, media_type="application/octet-stream")

@router.post("/db/restore")
async def restore_database(file: UploadFile = File(...)):
    """Restore SQLite database from uploaded backup file"""
    db_path = settings.DATABASE_URL.replace("sqlite:///", "")
    if not os.path.isabs(db_path):
        db_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), db_path)

    content = await file.read()
    if not content or len(content) < 100:
        raise HTTPException(status_code=400, detail="Uploaded file is empty or invalid SQLite file")

    with open(db_path, "wb") as f:
        f.write(content)

    return {"status": "success", "message": "Database restored successfully"}

