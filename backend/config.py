import os
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    PROJECT_NAME: str = "A-Share Stock Analysis Assistant"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"
    
    # Database
    DATABASE_URL: str = "sqlite:///./stock_assistant.db"
    
    # Default LLM Providers
    DEFAULT_PROVIDER: str = "deepseek"
    DEFAULT_MODEL: str = "deepseek-chat"
    
    # Scheduler Settings
    SCHEDULER_CRON_HOUR: int = 15
    SCHEDULER_CRON_MINUTE: int = 15
    
    class Config:
        case_sensitive = True

settings = Settings()
