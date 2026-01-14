"""
Claude Service - Stateless Two-Call Architecture with Visibility Support
=========================================================================
Call 1 (ANALYZE): Claude sees structure, returns action plan as JSON
Call 2 (FORMAT): Claude formats results into a nice response

Now supports visibility settings to hide user-specified data from AI.
"""

import httpx
import json
import asyncio
from typing import Optional, Any
from app.config import ANTHROPIC_API_KEY, CLAUDE_MODEL
from app.services.spreadsheet import (
    build_llm_context,
    execute_formula,
    execute_python_query,
    list_available_files,
)


ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"

# Retry config
MAX_RETRIES = 3
INITIAL_RETRY_DELAY = 2.0
MAX_RETRY_DELAY = 60.0


# =============================================================================
# PROMPTS
# =============================================================================

ANALYZE_PROMPT = """You are R-O-AI, a financial analyst. Analyze the user's question and return a JSON action plan.

You can see the spreadsheet STRUCTURE (headers, formulas, cell types) but NOT the actual numeric values.

## YOUR TASK:
1. Understand what the user wants to know
2. Figure out which cells/formulas will answer their question
3. Return a JSON action plan (I will execute it and show you the results)

## IMPORTANT: HIDDEN DATA
If the user has hidden certain columns, rows, or cells, they will be marked as hidden.
Do NOT reference hidden cells in your action plan - the user has chosen to keep this data private.

## AVAILABLE ACTIONS:

### formula
Execute an Excel formula. Use cell references from the structure.
{"action": "formula", "formula": "=SUM(G5:G10)", "sheet": "Sheet Name"}

### pandas  
Execute Python code with helpers:
- cell('Sheet', 'A1') → single value (any type)
- range_values('Sheet', 'A1:A10') → list of NUMERIC values only
- range_all('Sheet', 'A1:A10') → list of ALL values (text + numbers)

For portfolio data with stock symbols, use range_all:
{"action": "pandas", "code": "list(zip(range_all('Investment Analysis', 'A5:A10'), range_all('Investment Analysis', 'C5:C10'), range_all('Investment Analysis', 'D5:D10')))", "label": "holdings"}

### web_search
Search for current information. BATCH MULTIPLE ITEMS IN ONE SEARCH:
{"action": "web_search", "query": "current stock prices GOOGL AAPL MSFT AMZN January 2026"}

### multi
Execute multiple operations (use sparingly, max 2-3 steps):
{"action": "multi", "steps": [
  {"action": "pandas", "code": "...", "label": "portfolio_data"},
  {"action": "web_search", "query": "...", "label": "current_prices"}
]}

### none
If you can answer directly without data:
{"action": "none", "answer": "Your direct answer here"}

## EFFICIENCY RULES:
- **BATCH web searches**: One search for all stock prices, not separate searches
- **Use range_all() for text+numbers**: Stock symbols, names with their values
- **Use range_values() for numeric-only ranges**: Sums, calculations
- **Max 2-3 steps in multi**: Keep it simple
- **Respect hidden data**: Do not access cells the user has hidden

## EXAMPLE - Portfolio with current prices:
{"action": "multi", "steps": [
  {"action": "pandas", "code": "list(zip(range_all('Investment Analysis', 'A5:A10'), range_all('Investment Analysis', 'C5:C10'), range_all('Investment Analysis', 'D5:D10')))", "label": "holdings"},
  {"action": "web_search", "query": "stock prices UNH JNJ PFE GOOGL MSFT AAPL January 13 2026", "label": "prices"}
]}

## RESPONSE FORMAT:
You MUST respond with ONLY a valid JSON object. No preamble, no explanation, no markdown.
Do NOT write anything before the JSON. Just output the JSON starting with { and ending with }"""


FORMAT_PROMPT = """You are R-O-AI, a helpful financial assistant. 

The user asked a question and I've computed the results. Please write a clear, friendly response.

Keep it concise - just present the answer and a brief interpretation if helpful.
Don't explain how you computed it unless asked."""


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
) -> dict:
    """Make a single API call."""
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            ANTHROPIC_API_URL,
            headers={
                "Content-Type": "application/json",
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
            },
            json={
                "model": CLAUDE_MODEL,
                "max_tokens": max_tokens,
                "system": system,
                "messages": messages
            }
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
) -> dict:
    """API call with retry on rate limit."""
    for attempt in range(MAX_RETRIES):
        try:
            return await _api_call(messages, system, max_tokens)
        except RateLimitError as e:
            if attempt < MAX_RETRIES - 1:
                delay = min(e.retry_after or INITIAL_RETRY_DELAY * (2 ** attempt), MAX_RETRY_DELAY)
                print(f"⚠️  Rate limited, waiting {delay:.0f}s...")
                await asyncio.sleep(delay)
            else:
                raise
    raise RateLimitError()


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
# EXECUTION ENGINE
# =============================================================================

async def _execute_action(action: dict, file_id: str) -> dict:
    """Execute a single action and return result."""
    action_type = action.get("action")
    print(f"   Executing: {action_type}")
    
    if action_type == "formula":
        formula = action.get("formula", "")
        sheet = action.get("sheet")
        print(f"   Formula: {formula} on {sheet}")
        result = execute_formula(formula, file_id, sheet)
        return {"type": "formula", "formula": formula, "result": result}
    
    elif action_type == "pandas":
        code = action.get("code", "")
        print(f"   Code: {code[:80]}...")
        result = execute_python_query(code, file_id)
        return {"type": "pandas", "code": code, "result": result}
    
    elif action_type == "web_search":
        query = action.get("query", "")
        result = await _do_web_search(query)
        return {"type": "web_search", "query": query, "result": result}
    
    elif action_type == "multi":
        steps = action.get("steps", [])
        print(f"   Multi-step: {len(steps)} steps")
        results = {}
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


async def _do_web_search(query: str) -> str:
    """Execute web search using Claude's web_search tool with proper tool loop."""
    print(f"   🔍 Web search: {query}")
    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
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
                    "messages": [{"role": "user", "content": f"Search for: {query}. Return only the key facts, be very brief."}]
                }
            )
            
            if response.status_code == 429:
                retry_after = response.headers.get("retry-after", "60")
                print(f"   ⚠️ Web search rate limited, retry after {retry_after}s")
                return f"Rate limited - please wait {retry_after}s"
            
            response.raise_for_status()
            data = response.json()
            
            messages = [{"role": "user", "content": f"Search for: {query}. Return only the key facts, be very brief."}]
            
            for _ in range(3):
                if data.get("stop_reason") == "end_turn":
                    break
                    
                if data.get("stop_reason") == "tool_use":
                    assistant_content = data.get("content", [])
                    messages.append({"role": "assistant", "content": assistant_content})
                    
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
                        return "Rate limited during search"
                    
                    response.raise_for_status()
                    data = response.json()
                else:
                    break
            
            result = _extract_text(data)
            print(f"   ✓ Search complete: {result[:100]}...")
            return result if result else "No results found"
            
    except httpx.TimeoutException:
        print(f"   ⚠️ Web search timed out")
        return "Search timed out - try again"
    except Exception as e:
        print(f"   ⚠️ Web search error: {e}")
        return f"Search failed: {str(e)}"


# =============================================================================
# MAIN CHAT FUNCTION
# =============================================================================

async def list_models() -> dict:
    return {"models": [CLAUDE_MODEL], "default": CLAUDE_MODEL}


async def chat(
    messages: list[dict], 
    model: Optional[str] = None,
    visibility: Optional[dict] = None
) -> dict:
    """
    Two-call stateless chat with visibility support.
    
    Args:
        messages: Chat messages
        model: Model to use (optional)
        visibility: Dict of file_id -> {hiddenColumns, hiddenRows, hiddenCells}
    
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
    
    # Build context for analysis (with visibility filtering)
    spreadsheet_context = build_llm_context(visibility=visibility) or "No spreadsheet loaded."
    
    tool_calls_made = []
    
    try:
        # =====================================================================
        # CALL 1: ANALYZE - Get action plan
        # =====================================================================
        print("📊 Call 1: ANALYZE")
        
        analyze_system = ANALYZE_PROMPT + f"\n\n## SPREADSHEET STRUCTURE:\n{spreadsheet_context}"
        
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
        
        # Try to extract JSON using robust parsing
        action_plan = _extract_json_from_response(action_text)
        
        if action_plan is None:
            print(f"   ⚠️ No JSON found in response")
            print(f"   Raw response: {action_text[:200]}")
            # Return the raw response as a fallback
            return {
                "response": action_text,
                "model": CLAUDE_MODEL,
                "tool_calls": []
            }
        
        print(f"   Action: {action_plan.get('action')}")
        
        # =====================================================================
        # EXECUTE: Run the action plan locally
        # =====================================================================
        print("⚡ Executing action plan...")
        
        if action_plan.get("action") == "none":
            return {
                "response": action_plan.get("answer", ""),
                "model": CLAUDE_MODEL,
                "tool_calls": []
            }
        
        execution_result = await _execute_action(action_plan, file_id)
        
        # Format tool calls for frontend compatibility
        if execution_result.get("type") == "multi":
            for label, result in execution_result.get("results", {}).items():
                tool_calls_made.append({
                    "type": "pandas",
                    "code": label,
                    "result": result
                })
        else:
            tool_calls_made.append({
                "type": execution_result.get("type", "unknown"),
                "formula": execution_result.get("formula", ""),
                "code": execution_result.get("code", ""),
                "result": execution_result.get("result")
            })
        
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
            "tool_calls": tool_calls_made
        }
        
    except RateLimitError:
        return {
            "response": "⚠️ Rate limited. Please wait a minute and try again.",
            "model": CLAUDE_MODEL,
            "error": "rate_limit"
        }
    except httpx.TimeoutException:
        return {"response": "Request timed out.", "model": CLAUDE_MODEL, "error": "timeout"}
    except httpx.HTTPStatusError as e:
        return {"response": f"API error: {e.response.status_code}", "model": CLAUDE_MODEL, "error": f"http_{e.response.status_code}"}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"response": f"Error: {str(e)}", "model": CLAUDE_MODEL, "error": "unknown"}