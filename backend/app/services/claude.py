"""
Claude Service - Tool-Based Execution
=====================================
LLM sees only structure, generates formulas/code.
We execute locally and return results.
"""

import httpx
import json
from typing import Optional
from app.config import ANTHROPIC_API_KEY, CLAUDE_MODEL
from app.services.spreadsheet import (
    build_llm_context,
    execute_formula,
    execute_python_query,
    get_file_id_by_name,
    list_available_files,
    spreadsheet_context,
)


SYSTEM_PROMPT = """You are R-O-AI, a financial analysis assistant.

## HOW THIS WORKS:
- You can see the STRUCTURE of the user's spreadsheet (headers, labels, formulas, cell types)
- You CANNOT see the actual numeric values
- To answer questions, you must use cell references (like A5, C4:C10)
- I will execute your formulas on the real data and return the results
- You then present the results to the user

## AVAILABLE TOOLS:

### 1. execute_formula (PREFERRED)
Run Excel-style formulas using cell references.
- Supports: SUM, AVERAGE, COUNT, MAX, MIN, single cell references
- **Always use the exact cell addresses from the structure**

Examples:
- `=SUM(C5:C10)` - sum values in range
- `=AVERAGE(D5:D10)` - average of range  
- `=MAX(G5:G10)` - maximum value
- `=C5` - get single cell value

### 2. execute_pandas (FOR COMPLEX QUERIES)
Use the helper functions that work with cell references:

**IMPORTANT: Do NOT use DataFrame column names like `sheets['Sheet']['Column Name']` - they are unreliable.**

Instead, use these helper functions:
- `cell('Sheet Name', 'C5')` → returns value at cell C5
- `range_values('Sheet Name', 'C5:C10')` → returns list of numeric values in range

Examples:
```python
# Get a single value
cell('Investment Analysis', 'G8')

# Sum a range
sum(range_values('Investment Analysis', 'C5:C10'))

# Calculate with values
shares = cell('Investment Analysis', 'C8')
price = cell('Investment Analysis', 'E8')
shares * price * 2

# Average
values = range_values('Investment Analysis', 'G5:G10')
sum(values) / len(values)
```

### 3. web_search
Search for current market data (stock prices, exchange rates, etc.)

## WORKFLOW:
1. Look at the spreadsheet structure - note the exact cell addresses for headers and data
2. Identify which cells contain the data you need (e.g., "C4 is 'Shares Held', data in C5:C10")
3. Use execute_formula for simple calculations, execute_pandas with cell()/range_values() for complex ones
4. Present the result clearly

## CRITICAL RULES:
- **ALWAYS use cell references (A1, B2:B10) not column names**
- The structure shows you exactly which row has headers (e.g., row 4) and where data starts (e.g., row 5)
- Never guess cell addresses - use exactly what's shown in the structure
- If a formula fails, try the cell() or range_values() helpers instead

## RESPONSE FORMAT:
1. Briefly explain what you're calculating
2. Show the formula/code you're using
3. Present the result
4. Add brief interpretation if helpful

## PRIVACY:
- Never include user's data in web searches
- Only search for public information (stock tickers, rates, etc.)
"""


TOOLS = [
    {
        "name": "execute_formula",
        "description": "Execute an Excel-style formula on the spreadsheet. Use cell references like =SUM(C5:C10) or =AVERAGE(D5:D10). Supports SUM, AVERAGE, COUNT, MAX, MIN, and single cell references.",
        "input_schema": {
            "type": "object",
            "properties": {
                "formula": {
                    "type": "string",
                    "description": "The formula to execute using cell references, e.g., '=SUM(C5:C10)' or '=G8'"
                },
                "sheet_name": {
                    "type": "string",
                    "description": "Name of the sheet to execute on. Required for multi-sheet workbooks."
                }
            },
            "required": ["formula"]
        }
    },
    {
        "name": "execute_pandas",
        "description": "Execute Python code for complex queries. Use cell() and range_values() helpers instead of DataFrame column names. Examples: cell('Sheet', 'C5') returns a cell value, range_values('Sheet', 'C5:C10') returns a list of values, sum(range_values('Sheet', 'G5:G10')) sums a range.",
        "input_schema": {
            "type": "object",
            "properties": {
                "code": {
                    "type": "string",
                    "description": "Python code using cell('Sheet', 'A1') and range_values('Sheet', 'A1:A10') helpers. Example: cell('Investment Analysis', 'G8') * 2"
                }
            },
            "required": ["code"]
        }
    },
    {
        "type": "web_search_20250305",
        "name": "web_search"
    }
]


async def list_models() -> dict:
    """Return available Claude models"""
    return {
        "models": [CLAUDE_MODEL],
        "default": CLAUDE_MODEL
    }


async def chat(messages: list[dict], model: Optional[str] = None) -> dict:
    """
    Send chat messages to Claude API with tool support.
    """
    if not ANTHROPIC_API_KEY:
        return {
            "response": "Error: ANTHROPIC_API_KEY not configured.",
            "model": CLAUDE_MODEL
        }
    
    # Build system prompt with spreadsheet structure
    spreadsheet_data = build_llm_context()
    system_content = SYSTEM_PROMPT
    if spreadsheet_data:
        system_content += "\n\n## SPREADSHEET STRUCTURE:\n" + spreadsheet_data
        
        # Debug: show what LLM sees
        print("\n" + "="*60)
        print("📊 STRUCTURE SENT TO LLM (no numeric values):")
        print("="*60)
        print(spreadsheet_data[:1500])
        if len(spreadsheet_data) > 1500:
            print(f"\n... [{len(spreadsheet_data) - 1500} more chars]")
        print("="*60 + "\n")
    
    # Convert messages
    claude_messages = [{"role": m["role"], "content": m["content"]} for m in messages]
    
    # Get file_id for tool execution
    files = list_available_files()
    file_id = files[0]["file_id"] if files else None
    
    # Track tool calls for transparency
    tool_calls_made = []
    
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            # Initial request
            response = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "Content-Type": "application/json",
                    "x-api-key": ANTHROPIC_API_KEY,
                    "anthropic-version": "2023-06-01"
                },
                json={
                    "model": CLAUDE_MODEL,
                    "max_tokens": 4096,
                    "system": system_content,
                    "tools": TOOLS,
                    "messages": claude_messages
                }
            )
            response.raise_for_status()
            data = response.json()
            
            # Process tool calls in a loop
            while data.get("stop_reason") == "tool_use":
                tool_results = []
                assistant_content = data.get("content", [])
                
                for block in assistant_content:
                    if block.get("type") == "tool_use":
                        tool_name = block.get("name")
                        tool_input = block.get("input", {})
                        tool_id = block.get("id")
                        
                        print(f"🔧 Tool call: {tool_name}")
                        print(f"   Input: {json.dumps(tool_input, indent=2)}")
                        
                        # Execute tool
                        result = None
                        if tool_name == "execute_formula":
                            formula = tool_input.get("formula", "")
                            sheet = tool_input.get("sheet_name")
                            result = execute_formula(formula, file_id, sheet)
                            tool_calls_made.append({
                                "type": "formula",
                                "formula": formula,
                                "sheet": sheet,
                                "result": result
                            })
                        elif tool_name == "execute_pandas":
                            code = tool_input.get("code", "")
                            result = execute_python_query(code, file_id)
                            tool_calls_made.append({
                                "type": "pandas",
                                "code": code,
                                "result": result
                            })
                        
                        if result is not None:
                            print(f"   Result: {result}")
                            tool_results.append({
                                "type": "tool_result",
                                "tool_use_id": tool_id,
                                "content": json.dumps(result) if not isinstance(result, str) else result
                            })
                
                # If we have tool results, continue conversation
                if tool_results:
                    claude_messages.append({"role": "assistant", "content": assistant_content})
                    claude_messages.append({"role": "user", "content": tool_results})
                    
                    response = await client.post(
                        "https://api.anthropic.com/v1/messages",
                        headers={
                            "Content-Type": "application/json",
                            "x-api-key": ANTHROPIC_API_KEY,
                            "anthropic-version": "2023-06-01"
                        },
                        json={
                            "model": CLAUDE_MODEL,
                            "max_tokens": 4096,
                            "system": system_content,
                            "tools": TOOLS,
                            "messages": claude_messages
                        }
                    )
                    response.raise_for_status()
                    data = response.json()
                else:
                    break
            
            # Extract final text response
            response_text = ""
            for block in data.get("content", []):
                if block.get("type") == "text":
                    response_text += block.get("text", "")
            
            return {
                "response": response_text,
                "model": CLAUDE_MODEL,
                "tool_calls": tool_calls_made
            }
            
    except httpx.TimeoutException:
        return {"response": "Request timed out. Please try again.", "model": CLAUDE_MODEL}
    except httpx.HTTPStatusError as e:
        return {"response": f"API error: {e.response.status_code}", "model": CLAUDE_MODEL}
    except Exception as e:
        return {"response": f"Error: {str(e)}", "model": CLAUDE_MODEL}