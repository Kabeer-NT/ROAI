"""
Enhanced Suggestions Service - OPTIMIZED VERSION
=================================================
Performance optimizations:
1. TTL-based caching with LRU eviction
2. Shared HTTP connection pooling
3. Proper cache invalidation
4. Concurrent request handling

Original features preserved:
- Context-aware suggestions
- Follow-up question generation
- Haiku model for fast responses
"""

import hashlib
import json
import httpx
import time
from typing import Optional
from threading import Lock
from app.config import ANTHROPIC_API_KEY

# Use a fast, cheap model
SUGGESTIONS_MODEL = "claude-3-5-haiku-20241022"
ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"


# =============================================================================
# TTL CACHE IMPLEMENTATION
# =============================================================================

class TTLCache:
    """Thread-safe TTL cache with LRU-ish eviction."""
    
    def __init__(self, ttl: int = 3600, maxsize: int = 100):
        self._data: dict = {}
        self._timestamps: dict[str, float] = {}
        self._ttl = ttl
        self._maxsize = maxsize
        self._lock = Lock()
    
    def get(self, key: str, default=None):
        """Get value if exists and not expired."""
        with self._lock:
            if key not in self._data:
                return default
            
            # Check expiration
            if time.time() - self._timestamps.get(key, 0) > self._ttl:
                del self._data[key]
                del self._timestamps[key]
                return default
            
            return self._data[key]
    
    def set(self, key: str, value):
        """Set value with current timestamp."""
        with self._lock:
            # Evict if at capacity
            if len(self._data) >= self._maxsize and key not in self._data:
                self._evict_oldest()
            
            self._data[key] = value
            self._timestamps[key] = time.time()
    
    def _evict_oldest(self):
        """Remove oldest entries (by timestamp)."""
        if not self._timestamps:
            return
        
        # Remove oldest 25%
        to_remove = max(1, len(self._timestamps) // 4)
        oldest_keys = sorted(self._timestamps, key=self._timestamps.get)[:to_remove]
        
        for key in oldest_keys:
            self._data.pop(key, None)
            self._timestamps.pop(key, None)
    
    def clear(self):
        """Clear all entries."""
        with self._lock:
            self._data.clear()
            self._timestamps.clear()
    
    def __contains__(self, key: str) -> bool:
        """Check if key exists and is not expired."""
        return self.get(key) is not None
    
    def stats(self) -> dict:
        """Get cache statistics."""
        with self._lock:
            return {
                "size": len(self._data),
                "maxsize": self._maxsize,
                "ttl": self._ttl,
            }


# Cache instances with appropriate TTLs
_suggestions_cache = TTLCache(ttl=3600, maxsize=200)   # 1 hour for suggestions
_followup_cache = TTLCache(ttl=1800, maxsize=500)      # 30 min for followups


# =============================================================================
# HTTP CLIENT (shared with claude service if possible)
# =============================================================================

_http_client: Optional[httpx.AsyncClient] = None


def _get_http_client() -> httpx.AsyncClient:
    """Get or create shared HTTP client."""
    global _http_client
    
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(connect=5.0, read=15.0, write=10.0, pool=3.0),
            limits=httpx.Limits(
                max_keepalive_connections=5,
                max_connections=10,
                keepalive_expiry=30.0,
            ),
        )
    
    return _http_client


async def close_http_client():
    """Close HTTP client. Call on shutdown."""
    global _http_client
    if _http_client is not None:
        await _http_client.aclose()
        _http_client = None


# =============================================================================
# CACHE KEY GENERATION
# =============================================================================

def _cache_key(content: str) -> str:
    """Generate stable cache key from content."""
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
            "suggestions": _default_suggestions_list(),
            "cached": False
        }
    
    cache_key = _cache_key(spreadsheet_context)
    
    # Check cache first
    cached = _suggestions_cache.get(cache_key)
    if cached is not None:
        return {
            "suggestions": cached,
            "cached": True
        }
    
    if not ANTHROPIC_API_KEY:
        return _default_suggestions()
    
    try:
        client = _get_http_client()
        
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
            _suggestions_cache.set(cache_key, suggestions)
            return {"suggestions": suggestions, "cached": False}
        
        return _default_suggestions()
        
    except Exception as e:
        print(f"Suggestions error: {e}")
        return _default_suggestions()


def _default_suggestions() -> dict:
    return {
        "suggestions": _default_suggestions_list(),
        "cached": False
    }


def _default_suggestions_list() -> list[str]:
    return [
        "What are the key totals?",
        "Show me trends over time",
        "Which items perform best?",
        "Give me a quick summary"
    ]


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
    
    # Check cache first
    cached = _followup_cache.get(cache_key)
    if cached is not None:
        return {
            "followups": cached,
            "cached": True
        }
    
    if not ANTHROPIC_API_KEY:
        return _default_followups(user_question)
    
    try:
        context = f"""User asked: {user_question}

Assistant answered: {assistant_response[:500]}

Spreadsheet info: {spreadsheet_context[:500] if spreadsheet_context else 'N/A'}"""

        client = _get_http_client()
        
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
            _followup_cache.set(cache_key, followups)
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


def clear_all_caches():
    """Clear all suggestion caches."""
    _suggestions_cache.clear()
    _followup_cache.clear()


def get_cache_stats() -> dict:
    """Get statistics about cache usage."""
    return {
        "suggestions_cache": _suggestions_cache.stats(),
        "followup_cache": _followup_cache.stats(),
    }


# =============================================================================
# LIFECYCLE
# =============================================================================

async def shutdown():
    """Call on application shutdown."""
    await close_http_client()