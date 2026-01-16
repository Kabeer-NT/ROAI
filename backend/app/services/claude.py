"""
Claude Service - OPTIMIZED VERSION
===================================
Performance optimizations:
1. HTTP connection pooling (reuse connections)
2. HTTP/2 support for multiplexing
3. Async CPU offloading for spreadsheet operations
4. Proper lifecycle management

Original features preserved:
- Two-call stateless architecture (ANALYZE -> EXECUTE -> FORMAT)
- Visibility support
- Web search integration
- Rate limit handling with retry
"""

import httpx
import json
import asyncio
from typing import Optional, Any
from app.config import ANTHROPIC_API_KEY, CLAUDE_MODEL
from app.services.spreadsheet import (
    build_llm_context,
    build_llm_context_async,
    execute_formula,
    execute_formula_async,
    execute_python_query,
    execute_python_query_async,
    list_available_files,
    set_current_visibility,
)
from app.services.prompts import ANALYZE_PROMPT_ENHANCED as ANALYZE_PROMPT, FORMAT_PROMPT_ENHANCED as FORMAT_PROMPT


ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"

# Retry config
MAX_RETRIES = 3
INITIAL_RETRY_DELAY = 2.0
MAX_RETRY_DELAY = 60.0


# =============================================================================
# HTTP CLIENT POOLING
# =============================================================================

_http_client: Optional[httpx.AsyncClient] = None


def get_http_client() -> httpx.AsyncClient:
    """
    Get or create shared HTTP client with connection pooling.
    Reuses TCP connections and supports HTTP/2 multiplexing.
    """
    global _http_client
    
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(
                connect=10.0,      # Connection timeout
                read=60.0,         # Read timeout
                write=30.0,        # Write timeout
                pool=5.0,          # Pool timeout
            ),
            limits=httpx.Limits(
                max_keepalive_connections=10,  # Keep 10 connections alive
                max_connections=20,             # Max 20 total connections
                keepalive_expiry=30.0,          # Keep connections for 30s
            ),
            http2=True,  # Enable HTTP/2 for multiplexing
        )
    
    return _http_client


async def close_http_client():
    """Close HTTP client. Call on application shutdown."""
    global _http_client
    if _http_client is not None:
        await _http_client.aclose()
        _http_client = None


# =============================================================================
# API HELPERS
# =============================================================================

class RateLimitError(Exception):
    def __init__(self, retry_after: Optional[float] = None):
        self.retry_after = retry_after


async def _api_call(
    messages: list[dict],
    system: str,
    max_tokens: int = 1024,
    tools: list = None,
) -> dict:
    """Make a single API call using pooled connection."""
    client = get_http_client()
    
    payload = {
        "model": CLAUDE_MODEL,
        "max_tokens": max_tokens,
        "system": system,
        "messages": messages
    }
    
    if tools:
        payload["tools"] = tools
    
    response = await client.post(
        ANTHROPIC_API_URL,
        headers={
            "Content-Type": "application/json",
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
        },
        json=payload
    )
    
    if response.status_code == 429:
        retry_after = response.headers.get("retry-after")
        raise RateLimitError(float(retry_after) if retry_after else None)
    
    response.raise_for_status()
    return response.json()


async def _api_call_with_retry(
    messages: list[dict],
    system: str,
    max_tokens: int = 1024,
    tools: list = None,
) -> dict:
    """API call with exponential backoff retry on rate limit."""
    last_error = None
    
    for attempt in range(MAX_RETRIES):
        try:
            return await _api_call(messages, system, max_tokens, tools)
        except RateLimitError as e:
            last_error = e
            if attempt < MAX_RETRIES - 1:
                delay = min(
                    e.retry_after or INITIAL_RETRY_DELAY * (2 ** attempt),
                    MAX_RETRY_DELAY
                )
                print(f"⚠️  Rate limited, waiting {delay:.0f}s (attempt {attempt + 1}/{MAX_RETRIES})")
                await asyncio.sleep(delay)
            else:
                raise
        except httpx.TimeoutException as e:
            last_error = e
            if attempt < MAX_RETRIES - 1:
                delay = INITIAL_RETRY_DELAY * (2 ** attempt)
                print(f"⚠️  Timeout, retrying in {delay:.0f}s (attempt {attempt + 1}/{MAX_RETRIES})")
                await asyncio.sleep(delay)
            else:
                raise
    
    raise last_error or RateLimitError()


def _extract_text(response: dict) -> str:
    """Extract text content from API response."""
    return "".join(
        block.get("text", "")
        for block in response.get("content", [])
        if block.get("type") == "text"
    )


def _extract_json_from_response(text: str) -> dict | None:
    """Try multiple strategies to extract JSON from response."""
    text = text.strip()
    
    # Strategy 1: It's already valid JSON
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    
    # Strategy 2: JSON is wrapped in markdown code blocks
    if "```" in text:
        parts = text.split("```")
        for part in parts:
            part = part.strip()
            if part.startswith("json"):
                part = part[4:].strip()
            try:
                return json.loads(part)
            except json.JSONDecodeError:
                continue
    
    # Strategy 3: JSON is somewhere in the text (find first { to last })
    start = text.find('{')
    end = text.rfind('}')
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(text[start:end + 1])
        except json.JSONDecodeError:
            pass
    
    return None


# =============================================================================
# EXECUTION ENGINE (ASYNC OPTIMIZED)
# =============================================================================

async def _execute_action(action: dict, file_id: str) -> dict:
    """Execute a single action and return result. Uses async versions."""
    action_type = action.get("action")
    print(f"   Executing: {action_type}")
    
    if action_type == "formula":
        formula = action.get("formula", "")
        sheet = action.get("sheet")
        print(f"   Formula: {formula} on {sheet}")
        # Use async version to not block event loop
        result = await execute_formula_async(formula, file_id, sheet)
        return {"type": "formula", "formula": formula, "result": result}
    
    elif action_type == "pandas":
        code = action.get("code", "")
        print(f"   Code: {code[:80]}...")
        # Use async version to not block event loop
        result = await execute_python_query_async(code, file_id)
        return {"type": "pandas", "code": code, "result": result}
    
    elif action_type == "web_search":
        query = action.get("query", "")
        search_result = await _do_web_search(query)
        return {
            "type": "web_search", 
            "query": query, 
            "result": search_result.get("text", ""),
            "sources": search_result.get("sources", [])
        }
    
    elif action_type == "multi":
        steps = action.get("steps", [])
        print(f"   Multi-step: {len(steps)} steps")
        results = {}
        
        # Execute steps - could parallelize independent steps in future
        for i, step in enumerate(steps):
            label = step.get("label", f"step_{i}")
            print(f"   Step {i+1}/{len(steps)}: {label}")
            step_result = await _execute_action(step, file_id)
            results[label] = step_result.get("result")
        
        return {"type": "multi", "results": results}
    
    elif action_type == "none":
        return {"type": "none", "answer": action.get("answer", "")}
    
    else:
        return {"type": "error", "error": f"Unknown action: {action_type}"}


def _extract_sources_from_response(data: dict) -> list[dict]:
    """
    Extract source URLs and titles from web search response.
    
    The API returns sources in the content blocks, typically as:
    - Citations within text blocks
    - Dedicated source/citation blocks
    
    Returns list of {url, title, snippet} dicts.
    """
    sources = []
    seen_urls = set()
    
    for block in data.get("content", []):
        # Check for web_search_tool_result blocks
        if block.get("type") == "web_search_tool_result":
            for result in block.get("content", []):
                if result.get("type") == "web_search_result":
                    url = result.get("url", "")
                    if url and url not in seen_urls:
                        seen_urls.add(url)
                        sources.append({
                            "url": url,
                            "title": result.get("title", ""),
                            "snippet": result.get("snippet", result.get("content", ""))[:200],
                        })
        
        # Check for citations in text blocks
        if block.get("type") == "text":
            citations = block.get("citations", [])
            for citation in citations:
                url = citation.get("url", "")
                if url and url not in seen_urls:
                    seen_urls.add(url)
                    sources.append({
                        "url": url,
                        "title": citation.get("title", ""),
                        "snippet": citation.get("cited_text", "")[:200],
                    })
    
    return sources


async def _do_web_search(query: str) -> dict:
    """
    Execute web search using Claude's web_search tool.
    
    Returns dict with:
        - text: The summarized search results
        - sources: List of {url, title, snippet} for citations
    """
    print(f"   🔍 Web search: {query}")
    
    all_sources = []
    
    try:
        client = get_http_client()
        
        initial_message = {
            "role": "user",
            "content": f"Search for: {query}. Return only the key facts, be very brief."
        }
        
        response = await client.post(
            ANTHROPIC_API_URL,
            headers={
                "Content-Type": "application/json",
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
            },
            json={
                "model": CLAUDE_MODEL,
                "max_tokens": 1024,
                "tools": [{"type": "web_search_20250305", "name": "web_search"}],
                "messages": [initial_message]
            }
        )
        
        if response.status_code == 429:
            retry_after = response.headers.get("retry-after", "60")
            print(f"   ⚠️ Web search rate limited, retry after {retry_after}s")
            return {
                "text": f"Rate limited - please wait {retry_after}s",
                "sources": []
            }
        
        response.raise_for_status()
        data = response.json()
        
        # Extract sources from initial response
        all_sources.extend(_extract_sources_from_response(data))
        
        messages = [initial_message]
        
        # Handle tool use loop (max 3 iterations)
        for _ in range(3):
            if data.get("stop_reason") == "end_turn":
                break
            
            if data.get("stop_reason") == "tool_use":
                assistant_content = data.get("content", [])
                messages.append({"role": "assistant", "content": assistant_content})
                
                # Extract sources from tool use response
                for block in assistant_content:
                    if block.get("type") == "web_search_tool_result":
                        all_sources.extend(_extract_sources_from_response({"content": [block]}))
                
                tool_results = []
                for block in assistant_content:
                    if block.get("type") == "tool_use":
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": block.get("id"),
                            "content": "Search completed - please summarize the results briefly."
                        })
                
                if tool_results:
                    messages.append({"role": "user", "content": tool_results})
                
                response = await client.post(
                    ANTHROPIC_API_URL,
                    headers={
                        "Content-Type": "application/json",
                        "x-api-key": ANTHROPIC_API_KEY,
                        "anthropic-version": "2023-06-01",
                    },
                    json={
                        "model": CLAUDE_MODEL,
                        "max_tokens": 512,
                        "tools": [{"type": "web_search_20250305", "name": "web_search"}],
                        "messages": messages
                    }
                )
                
                if response.status_code == 429:
                    return {
                        "text": "Rate limited during search",
                        "sources": all_sources
                    }
                
                response.raise_for_status()
                data = response.json()
                
                # Extract sources from follow-up response
                all_sources.extend(_extract_sources_from_response(data))
            else:
                break
        
        result_text = _extract_text(data)
        print(f"   ✓ Search complete: {result_text[:100]}...")
        print(f"   📚 Found {len(all_sources)} sources")
        
        # Deduplicate sources by URL
        unique_sources = []
        seen = set()
        for src in all_sources:
            if src["url"] not in seen:
                seen.add(src["url"])
                unique_sources.append(src)
        
        return {
            "text": result_text if result_text else "No results found",
            "sources": unique_sources[:10]  # Limit to top 10 sources
        }
        
    except httpx.TimeoutException:
        print(f"   ⚠️ Web search timed out")
        return {"text": "Search timed out - try again", "sources": []}
    except Exception as e:
        print(f"   ⚠️ Web search error: {e}")
        return {"text": f"Search failed: {str(e)}", "sources": []}


# =============================================================================
# MAIN CHAT FUNCTION
# =============================================================================

async def list_models() -> dict:
    """List available models."""
    return {"models": [CLAUDE_MODEL], "default": CLAUDE_MODEL}


async def chat(
    messages: list[dict],
    model: Optional[str] = None,
    visibility: Optional[dict] = None,
    selection_context: Optional[dict] = None
) -> dict:
    """
    Two-call stateless chat with visibility support.
    
    Optimizations:
    - Uses connection pooling for API calls
    - Async CPU offloading for spreadsheet operations
    - Cached workbooks and compiled visibility
    
    Args:
        messages: Chat messages
        model: Model to use (optional)
        visibility: Dict of file_id -> {hiddenColumns, hiddenRows, hiddenCells}
        selection_context: Optional dict with {sheet, range, cells} for focused analysis
    
    Returns:
        Response dict with 'response', 'model', and 'tool_calls'
    """
    if not ANTHROPIC_API_KEY:
        return {"response": "Error: ANTHROPIC_API_KEY not configured.", "model": CLAUDE_MODEL}
    
    # Get the user's question (last message)
    user_question = messages[-1]["content"] if messages else ""
    
    # Get file context
    files = list_available_files()
    file_id = files[0]["file_id"] if files else None
    
    # Set visibility for execution
    set_current_visibility(visibility)
    
    # Build context for analysis (async to not block)
    spreadsheet_context = await build_llm_context_async(visibility) or "No spreadsheet loaded."
    
    tool_calls_made = []
    
    try:
        # =====================================================================
        # CALL 1: ANALYZE - Get action plan
        # =====================================================================
        print("📊 Call 1: ANALYZE")
        
        analyze_system = ANALYZE_PROMPT + f"\n\n## SPREADSHEET STRUCTURE:\n{spreadsheet_context}"
        
        # Add selection context if user selected specific cells
        if selection_context:
            selection_hint = f"""

## USER SELECTION CONTEXT:
The user has selected specific cells to ask about:
- Sheet: "{selection_context.get('sheet', 'unknown')}"
- Range: {selection_context.get('range', 'unknown')}

Focus your analysis on this specific range. When using formulas or pandas, target these cells specifically."""
            analyze_system += selection_hint
            print(f"   📍 Selection context: {selection_context.get('range')} on {selection_context.get('sheet')}")
        
        analyze_response = await _api_call_with_retry(
            messages=[{"role": "user", "content": user_question}],
            system=analyze_system,
            max_tokens=1024
        )
        
        # Log token usage
        usage = analyze_response.get("usage", {})
        print(f"   Tokens: {usage.get('input_tokens', '?')} in, {usage.get('output_tokens', '?')} out")
        
        # Parse the action plan
        action_text = _extract_text(analyze_response).strip()
        action_plan = _extract_json_from_response(action_text)
        
        if action_plan is None:
            print(f"   ⚠️ No JSON found in response")
            print(f"   Raw response: {action_text[:200]}")
            return {
                "response": action_text,
                "model": CLAUDE_MODEL,
                "tool_calls": []
            }
        
        print(f"   Action: {action_plan.get('action')}")
        
        # =====================================================================
        # EXECUTE: Run the action plan (async)
        # =====================================================================
        print("⚡ Executing action plan...")
        
        if action_plan.get("action") == "none":
            return {
                "response": action_plan.get("answer", ""),
                "model": CLAUDE_MODEL,
                "tool_calls": []
            }
        
        execution_result = await _execute_action(action_plan, file_id)
        
        # Format tool calls for frontend
        web_sources = []  # Collect sources from web searches
        
        if execution_result.get("type") == "multi":
            for label, result in execution_result.get("results", {}).items():
                tool_calls_made.append({
                    "type": "pandas",
                    "code": label,
                    "result": result
                })
        else:
            tool_call = {
                "type": execution_result.get("type", "unknown"),
                "formula": execution_result.get("formula", ""),
                "code": execution_result.get("code", ""),
                "query": execution_result.get("query", ""),
                "result": execution_result.get("result")
            }
            
            # Include sources if this was a web search
            if execution_result.get("type") == "web_search":
                sources = execution_result.get("sources", [])
                tool_call["sources"] = sources
                web_sources.extend(sources)
            
            tool_calls_made.append(tool_call)
        
        print(f"   Result: {json.dumps(execution_result.get('result', execution_result), default=str)[:200]}")
        
        # =====================================================================
        # CALL 2: FORMAT - Generate nice response
        # =====================================================================
        print("✨ Call 2: FORMAT")
        
        if execution_result.get("type") == "multi":
            result_summary = execution_result.get("results", {})
        else:
            result_summary = execution_result.get("result", execution_result)
        
        format_context = f"""User question: {user_question}

Computed result: {json.dumps(result_summary, default=str)}"""
        
        format_response = await _api_call_with_retry(
            messages=[{"role": "user", "content": format_context}],
            system=FORMAT_PROMPT,
            max_tokens=512
        )
        
        usage = format_response.get("usage", {})
        print(f"   Tokens: {usage.get('input_tokens', '?')} in, {usage.get('output_tokens', '?')} out")
        
        final_response = _extract_text(format_response)
        
        return {
            "response": final_response,
            "model": CLAUDE_MODEL,
            "tool_calls": tool_calls_made,
            "sources": web_sources  # Include web sources at top level for easy access
        }
        
    except RateLimitError:
        return {
            "response": "⚠️ Rate limited. Please wait a minute and try again.",
            "model": CLAUDE_MODEL,
            "error": "rate_limit"
        }
    except httpx.TimeoutException:
        return {
            "response": "Request timed out. Please try again.",
            "model": CLAUDE_MODEL,
            "error": "timeout"
        }
    except httpx.HTTPStatusError as e:
        return {
            "response": f"API error: {e.response.status_code}",
            "model": CLAUDE_MODEL,
            "error": f"http_{e.response.status_code}"
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {
            "response": f"Error: {str(e)}",
            "model": CLAUDE_MODEL,
            "error": "unknown"
        }


# =============================================================================
# LIFECYCLE MANAGEMENT
# =============================================================================

async def startup():
    """Call on application startup."""
    # Pre-warm the HTTP client
    get_http_client()


async def shutdown():
    """Call on application shutdown."""
    await close_http_client()