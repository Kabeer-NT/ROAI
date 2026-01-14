"""
Suggestions Route - Quick LLM call for personalized question suggestions
Add this to your spreadsheet.py routes or create a new suggestions.py
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
import httpx
import json

from app.services.db import get_db
from app.services.auth import get_current_user
from app.services.spreadsheet import spreadsheet_context, build_llm_context
from app.config import ANTHROPIC_API_KEY
from app.models import User

# If adding to existing router, skip this line
router = APIRouter(tags=["suggestions"])

# Use a fast, cheap model for suggestions
SUGGESTIONS_MODEL = "claude-3-5-haiku-20241022"
ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"

SUGGESTIONS_PROMPT = """Based on this spreadsheet structure, suggest 4 specific, actionable questions the user might want to ask about their data.

Rules:
- Be specific to THIS data (use actual column names, sheet names)
- Focus on insights, calculations, comparisons, and trends
- Keep questions concise (under 10 words each)
- Make them immediately useful
- Vary the types: summary, calculation, comparison, trend

Return ONLY a JSON array of 4 strings, nothing else:
["question 1", "question 2", "question 3", "question 4"]"""


class SuggestionsResponse(BaseModel):
    suggestions: list[str]
    cached: bool = False


# Simple in-memory cache (in production, use Redis)
_suggestions_cache: dict[str, list[str]] = {}


@router.get("/spreadsheet/suggestions", response_model=SuggestionsResponse)
async def get_suggestions(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get AI-generated question suggestions based on uploaded spreadsheets.
    Uses a fast model (Haiku) for quick responses.
    """
    # Build context from all loaded files
    context = build_llm_context()
    
    if not context:
        # Return default suggestions if no files loaded
        return SuggestionsResponse(
            suggestions=[
                "What's my highest revenue month?",
                "Calculate the average value",
                "Which items are most profitable?",
                "Show me a summary of all data",
            ],
            cached=False
        )
    
    # Create cache key from context hash
    cache_key = str(hash(context))
    
    # Check cache
    if cache_key in _suggestions_cache:
        return SuggestionsResponse(
            suggestions=_suggestions_cache[cache_key],
            cached=True
        )
    
    if not ANTHROPIC_API_KEY:
        raise HTTPException(status_code=500, detail="API key not configured")
    
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                ANTHROPIC_API_URL,
                headers={
                    "Content-Type": "application/json",
                    "x-api-key": ANTHROPIC_API_KEY,
                    "anthropic-version": "2023-06-01",
                },
                json={
                    "model": SUGGESTIONS_MODEL,
                    "max_tokens": 256,
                    "system": SUGGESTIONS_PROMPT,
                    "messages": [
                        {"role": "user", "content": f"Spreadsheet structure:\n{context}"}
                    ]
                }
            )
            
            if response.status_code == 429:
                # Rate limited - return defaults
                return SuggestionsResponse(
                    suggestions=[
                        "Summarize the key metrics",
                        "What are the totals?",
                        "Show trends over time",
                        "Compare the categories",
                    ],
                    cached=False
                )
            
            response.raise_for_status()
            data = response.json()
            
            # Extract text content
            text = ""
            for block in data.get("content", []):
                if block.get("type") == "text":
                    text += block.get("text", "")
            
            # Parse JSON array
            text = text.strip()
            
            # Handle markdown code blocks
            if "```" in text:
                parts = text.split("```")
                for part in parts:
                    part = part.strip()
                    if part.startswith("json"):
                        part = part[4:].strip()
                    if part.startswith("["):
                        text = part
                        break
            
            # Find JSON array
            start = text.find("[")
            end = text.rfind("]")
            if start != -1 and end != -1:
                json_str = text[start:end + 1]
                suggestions = json.loads(json_str)
                
                # Validate and limit to 4
                if isinstance(suggestions, list):
                    suggestions = [str(s) for s in suggestions[:4]]
                    
                    # Cache the result
                    _suggestions_cache[cache_key] = suggestions
                    
                    # Limit cache size
                    if len(_suggestions_cache) > 100:
                        # Remove oldest entries
                        keys = list(_suggestions_cache.keys())
                        for k in keys[:50]:
                            del _suggestions_cache[k]
                    
                    return SuggestionsResponse(
                        suggestions=suggestions,
                        cached=False
                    )
            
            # Fallback if parsing fails
            return SuggestionsResponse(
                suggestions=[
                    "What are the key totals?",
                    "Show me a summary",
                    "What are the trends?",
                    "Compare the data",
                ],
                cached=False
            )
            
    except httpx.TimeoutException:
        return SuggestionsResponse(
            suggestions=[
                "Summarize this data",
                "What are the totals?",
                "Show key insights",
                "Compare values",
            ],
            cached=False
        )
    except Exception as e:
        print(f"Suggestions error: {e}")
        return SuggestionsResponse(
            suggestions=[
                "What are the key metrics?",
                "Calculate the totals",
                "Show me trends",
                "Summarize the data",
            ],
            cached=False
        )


@router.delete("/spreadsheet/suggestions/cache")
async def clear_suggestions_cache(
    current_user: User = Depends(get_current_user),
):
    """Clear the suggestions cache (useful when files change)."""
    _suggestions_cache.clear()
    return {"success": True}