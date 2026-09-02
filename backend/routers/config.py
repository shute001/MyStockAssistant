from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
from database import get_db, LLMConfig
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
