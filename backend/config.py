import os
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    PROJECT_NAME: str = "A-Share Stock Analysis Assistant"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"
    
    # Database
    BACKEND_DIR: str = os.path.dirname(os.path.abspath(__file__))
    DATABASE_URL: str = f"sqlite:///{os.path.join(BACKEND_DIR, 'stock_assistant.db').replace(chr(92), '/')}"
    
    # Default LLM Providers
    DEFAULT_PROVIDER: str = "deepseek"
    DEFAULT_MODEL: str = "deepseek-chat"
    
    # Scheduler Settings
    SCHEDULER_CRON_HOUR: int = 15
    SCHEDULER_CRON_MINUTE: int = 15

    # Comma-separated frontend origins. Keep the default local-only; production
    # deployments must explicitly list their trusted origins in the environment.
    CORS_ORIGINS: str = "http://127.0.0.1:5173,http://localhost:5173"
    
    class Config:
        case_sensitive = True

settings = Settings()
