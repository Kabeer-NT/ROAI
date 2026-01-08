"""
ROAI Configuration
"""

import os
from dotenv import load_dotenv

load_dotenv()

# Ollama settings
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
DEFAULT_MODEL = os.getenv("DEFAULT_MODEL", "llama3.1")

# Claude settings (optional)
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")

# Auth settings
SECRET_KEY = os.getenv("SECRET_KEY", "change-me-in-production-use-openssl-rand-hex-32")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days

# Database
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./roai.db")
