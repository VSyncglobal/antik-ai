import os
from dotenv import load_dotenv

load_dotenv()

class Settings:
    PROJECT_NAME: str = "Antik AI"
    # Mandatory Security: Raise error if SECRET_KEY is missing
    SECRET_KEY: str = os.getenv("ANTIK_SECRET_KEY")
    if not SECRET_KEY:
        raise ValueError("CRITICAL: ANTIK_SECRET_KEY not found in environment.")
    
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 1 week
    
    # Database
    DATABASE_URL: str = os.getenv("DATABASE_URL", "postgresql://user:pass@localhost/antik")

settings = Settings()