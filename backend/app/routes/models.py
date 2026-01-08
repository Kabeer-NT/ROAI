"""
Models Route (Public)
"""

from fastapi import APIRouter
from app.services import ollama

router = APIRouter(tags=["models"])


@router.get("/models")
async def get_models():
    return await ollama.list_models()
