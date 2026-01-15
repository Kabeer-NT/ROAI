"""
Suggestions Routes
==================
Better suggestions with proper caching and context-awareness.
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.services.db import get_db
from app.services.auth import get_current_user
from app.services.spreadsheet import build_llm_context
from app.services.suggestions import (
    generate_suggestions,
    generate_followups,
    clear_all_caches,
)
from app.models import User

router = APIRouter(tags=["suggestions"])


# =============================================================================
# RESPONSE MODELS
# =============================================================================

class SuggestionsResponse(BaseModel):
    suggestions: list[str]
    cached: bool = False


class FollowupsRequest(BaseModel):
    question: str
    answer: str


class FollowupsResponse(BaseModel):
    followups: list[str]
    cached: bool = False


# =============================================================================
# ENDPOINTS
# =============================================================================

@router.get("/spreadsheet/suggestions", response_model=SuggestionsResponse)
async def get_suggestions(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get AI-generated question suggestions based on uploaded spreadsheets.
    Uses a fast model (Haiku) for quick responses with caching.
    """
    context = build_llm_context()
    
    result = await generate_suggestions(context)
    
    return SuggestionsResponse(
        suggestions=result["suggestions"],
        cached=result["cached"]
    )


@router.post("/chat/followups", response_model=FollowupsResponse)
async def get_followups(
    request: FollowupsRequest,
    current_user: User = Depends(get_current_user),
):
    """
    Get follow-up question suggestions after a chat exchange.
    """
    context = build_llm_context()
    
    result = await generate_followups(
        request.question,
        request.answer,
        context
    )
    
    return FollowupsResponse(
        followups=result["followups"],
        cached=result["cached"]
    )


@router.delete("/suggestions/cache")
async def clear_cache(
    current_user: User = Depends(get_current_user),
):
    """Clear all suggestion caches. Useful when files change."""
    clear_all_caches()
    return {"success": True, "message": "All caches cleared"}