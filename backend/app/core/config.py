import os
import secrets
from typing import List
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    PROJECT_NAME: str = "SecureDocs AI"
    VERSION: str = "1.0.0"
    ENV: str = "development"  # "development" | "production" | "test"
    
    # Secrets - in production, startup check enforces these are set
    SECRET_KEY: str = "insecure-dev-secret-key-change-in-prod-0123456789abcdef"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 12  # 12 hours
    
    # AES-256-GCM Master Key (32 bytes = 64 hex characters or 32 raw bytes)
    AES_SECRET_KEY: str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    
    # Database
    DATABASE_URL: str = "sqlite+aiosqlite:///./ledger_vault.db"
    
    # Storage Directory (encrypted files stored here)
    STORAGE_DIR: str = "./vault_storage"
    
    # Frontend Origin for CORS
    FRONTEND_URL: str = "http://localhost:5173"
    ALLOWED_ORIGINS: List[str] = [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000"
    ]
    
    # Redis for rate limiting (fallback to in-memory if unreachable)
    REDIS_URL: str = "redis://localhost:6379/0"
    
    # Demo Mode (in-app demo inbox for external OTP codes)
    DEMO_MODE: bool = True

    # Email / SMTP Delivery Modes: "demo" | "smtp" | "mailpit" | "resend"
    MAIL_MODE: str = "demo"
    SMTP_HOST: str = "localhost"
    SMTP_PORT: int = 1025
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = "security@securedocs.ai"
    MAIL_FROM: str = "security@securedocs.ai"
    RESEND_API_KEY: str = ""
    
    # Cloudflare Turnstile CAPTCHA (dev key always passes: 1x00000000000000000000AA)
    TURNSTILE_SECRET_KEY: str = "1x0000000000000000000000000000000AA"
    TURNSTILE_SITE_KEY: str = "1x00000000000000000000AA"
    
    model_config = SettingsConfigDict(env_file=".env", extra="allow")

settings = Settings()

def verify_production_secrets():
    """Startup verification: in production mode, refuse to boot if critical secrets are unset."""
    if settings.ENV.lower() == "production":
        required_secrets = [
            ("SECRET_KEY", settings.SECRET_KEY, "insecure-dev-secret-key-change-in-prod-0123456789abcdef"),
            ("AES_SECRET_KEY", settings.AES_SECRET_KEY, "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"),
        ]
        missing = []
        for name, val, default_val in required_secrets:
            if not val or val == default_val:
                missing.append(name)
        
        if missing:
            msg = f"FATAL: Production mode refusal to boot. Missing or default critical secrets: {', '.join(missing)}"
            print(msg)
            raise RuntimeError(msg)
