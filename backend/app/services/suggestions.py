"""
Enhanced Suggestions Service
============================
- Better context-aware suggestions
- Follow-up question generation
- Caching with proper keys
"""

import hashlib
import json
import httpx
from typing import Optional
from app.config import ANTHROPIC_API_KEY

# Use a fast, cheap model
SUGGESTIONS_MODEL = "claude-3-5-haiku-20241022"
ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"

# Cache with proper hashing
_suggestions_cache: dict[str, list[str]] = {}
_followup_cache: dict[str, list[str]] = {}


def _cache_key(content: str) -> str:
    """Generate stable cache key."""
    return hashlib.sha256(content.encode()).hexdigest()[:16]


# =============================================================================
# INITIAL SUGGESTIONS (On Upload / Page Load)
# =============================================================================

SUGGESTIONS_PROMPT = """Based on this spreadsheet structure, suggest 4 specific questions that would give IMMEDIATE business value.

RULES:
- Use ACTUAL column names you see (e.g., "Revenue", "Product", "Date")
- Be specific and actionable
- Focus on: totals, comparisons, trends, top performers
- Sound like a business owner, not a data analyst
- Keep each question under 10 words

GOOD examples:
- "What's my total Revenue for Q4?"
- "Which Product has the highest sales?"
- "How did January compare to December?"
- "Who are my top 5 customers?"

BAD examples (too vague):
- "Summarize the data"
- "Show me insights"
- "Analyze the spreadsheet"

Return ONLY a JSON array of 4 strings:
["question 1", "question 2", "question 3", "question 4"]"""


async def generate_suggestions(spreadsheet_context: str) -> dict:
    """
    Generate smart suggestions based on spreadsheet structure.
    Returns {suggestions: [...], cached: bool}
    """
    if not spreadsheet_context:
        return {
            "suggestions": [
                "What are the key totals?",
                "Show me a summary",
                "What trends do you see?",
                "Are there any issues with the data?"
            ],
            "cached": False
        }
    
    cache_key = _cache_key(spreadsheet_context)
    
    if cache_key in _suggestions_cache:
        return {
            "suggestions": _suggestions_cache[cache_key],
            "cached": True
        }
    
    if not ANTHROPIC_API_KEY:
        return _default_suggestions()
    
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
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
                        {"role": "user", "content": f"Spreadsheet structure:\n{spreadsheet_context}"}
                    ]
                }
            )
            
            if response.status_code == 429:
                return _default_suggestions()
            
            response.raise_for_status()
            data = response.json()
            
            suggestions = _parse_json_array(data)
            
            if suggestions:
                _suggestions_cache[cache_key] = suggestions
                _limit_cache_size(_suggestions_cache)
                return {"suggestions": suggestions, "cached": False}
            
            return _default_suggestions()
            
    except Exception as e:
        print(f"Suggestions error: {e}")
        return _default_suggestions()


def _default_suggestions() -> dict:
    return {
        "suggestions": [
            "What are the key totals?",
            "Show me trends over time",
            "Which items perform best?",
            "Give me a quick summary"
        ],
        "cached": False
    }


# =============================================================================
# FOLLOW-UP SUGGESTIONS (After Each Response)
# =============================================================================

FOLLOWUP_PROMPT = """The user asked a question about their spreadsheet and got an answer. Suggest 3 natural follow-up questions they might want to ask next.

RULES:
- Follow-ups should DEEPEN the analysis, not repeat it
- Be specific to what was just discussed
- Use natural language like "How does that compare to..." or "Which ones specifically..."
- Keep each under 12 words

PATTERNS:
- After totals → ask about breakdown, comparison, or trend
- After comparison → ask about reasons, details, or different period
- After top items → ask about bottom items, or what changed
- After trends → ask about specific periods or anomalies

Return ONLY a JSON array of 3 strings:
["follow-up 1", "follow-up 2", "follow-up 3"]"""


async def generate_followups(
    user_question: str,
    assistant_response: str,
    spreadsheet_context: str = ""
) -> dict:
    """
    Generate contextual follow-up suggestions after a response.
    Returns {followups: [...], cached: bool}
    """
    # Create cache key from question + response summary
    cache_content = f"{user_question}|{assistant_response[:200]}"
    cache_key = _cache_key(cache_content)
    
    if cache_key in _followup_cache:
        return {
            "followups": _followup_cache[cache_key],
            "cached": True
        }
    
    if not ANTHROPIC_API_KEY:
        return _default_followups(user_question)
    
    try:
        context = f"""User asked: {user_question}

Assistant answered: {assistant_response[:500]}

Spreadsheet info: {spreadsheet_context[:500] if spreadsheet_context else 'N/A'}"""

        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                ANTHROPIC_API_URL,
                headers={
                    "Content-Type": "application/json",
                    "x-api-key": ANTHROPIC_API_KEY,
                    "anthropic-version": "2023-06-01",
                },
                json={
                    "model": SUGGESTIONS_MODEL,
                    "max_tokens": 200,
                    "system": FOLLOWUP_PROMPT,
                    "messages": [
                        {"role": "user", "content": context}
                    ]
                }
            )
            
            if response.status_code == 429:
                return _default_followups(user_question)
            
            response.raise_for_status()
            data = response.json()
            
            followups = _parse_json_array(data, max_items=3)
            
            if followups:
                _followup_cache[cache_key] = followups
                _limit_cache_size(_followup_cache)
                return {"followups": followups, "cached": False}
            
            return _default_followups(user_question)
            
    except Exception as e:
        print(f"Followup generation error: {e}")
        return _default_followups(user_question)


def _default_followups(question: str) -> dict:
    """Generate generic but sensible follow-ups based on question type."""
    q_lower = question.lower()
    
    if any(word in q_lower for word in ['total', 'sum', 'how much']):
        return {
            "followups": [
                "How does that break down by category?",
                "How does this compare to last period?",
                "Which items contribute most to that total?"
            ],
            "cached": False
        }
    
    if any(word in q_lower for word in ['compare', 'vs', 'versus', 'difference']):
        return {
            "followups": [
                "What's driving that difference?",
                "Show me the month-by-month breakdown",
                "Which categories changed the most?"
            ],
            "cached": False
        }
    
    if any(word in q_lower for word in ['top', 'best', 'highest', 'most']):
        return {
            "followups": [
                "What about the bottom performers?",
                "How have these changed over time?",
                "What percentage of the total do they represent?"
            ],
            "cached": False
        }
    
    if any(word in q_lower for word in ['trend', 'over time', 'growth', 'change']):
        return {
            "followups": [
                "What caused the biggest changes?",
                "Compare this year to last year",
                "Which months were strongest?"
            ],
            "cached": False
        }
    
    # Generic fallback
    return {
        "followups": [
            "Can you break that down further?",
            "How does this compare to previous periods?",
            "What else should I know about this?"
        ],
        "cached": False
    }


# =============================================================================
# HELPERS
# =============================================================================

def _parse_json_array(api_response: dict, max_items: int = 4) -> list[str]:
    """Extract JSON array from API response."""
    text = ""
    for block in api_response.get("content", []):
        if block.get("type") == "text":
            text += block.get("text", "")
    
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
        try:
            json_str = text[start:end + 1]
            items = json.loads(json_str)
            
            if isinstance(items, list):
                return [str(s).strip() for s in items[:max_items] if s]
        except json.JSONDecodeError:
            pass
    
    return []


def _limit_cache_size(cache: dict, max_size: int = 100):
    """Remove old entries if cache gets too large."""
    if len(cache) > max_size:
        keys = list(cache.keys())
        for k in keys[:max_size // 2]:
            del cache[k]


def clear_all_caches():
    """Clear all suggestion caches."""
    _suggestions_cache.clear()
    _followup_cache.clear()