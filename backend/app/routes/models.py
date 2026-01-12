"""
Models Route (Public)
"""

from fastapi import APIRouter
from app.services import claude

router = APIRouter(tags=["models"])


@router.get("/models")
async def get_models():
    return await claude.list_models()