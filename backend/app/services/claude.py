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
- To answer questions, you must generate formulas or pandas code
- I will execute your formulas on the real data and return the results
- You then present the results to the user

## CRITICAL RULES - ALWAYS FOLLOW:

1. **ALWAYS SHOW YOUR FORMULA FIRST** - Before executing, explain what you're computing:
   "To calculate X, I'll use: `=FORMULA` which computes Y from Z"

2. **DERIVE, DON'T JUST READ** - Even if a total cell exists, show the underlying formula.
   BAD: "I'll read cell G11"
   GOOD: "I'll sum the Gain/Loss column: `=SUM(G4:G9)`"

3. **EXPLAIN THE LOGIC** - Show which columns/rows you're using and why:
   "Column G contains 'Gain/Loss $', rows 4-9 are the stock positions"

4. **USE PANDAS FOR COMPLEX QUERIES** - When formulas aren't enough:
   "I'll calculate percentage returns: `sheets['Investment Analysis']['Gain/Loss %'].mean()`"

## RESPONSE FORMAT:

For every numeric question, structure your response like this:

**Analysis:**
- Identified [what data you found in the structure]
- Column X contains [field name], rows Y-Z contain [data type]

**Formula:**
```
=YOUR_FORMULA_HERE
```
or
```python
sheets['SheetName']['Column'].operation()
```

**Result:** [executed result]

**Interpretation:** [what this means for the user]

## AVAILABLE TOOLS:

1. **execute_formula** - Run Excel-style formulas
   - Supports: SUM, AVERAGE, COUNT, MAX, MIN, cell references
   - Example: =SUM(H2:H7) or =AVERAGE(E2:E10)

2. **execute_pandas** - Run pandas code for complex queries
   - You have access to `sheets` dict containing DataFrames
   - Example: sheets['Investment Analysis']['Gain/Loss $'].sum()

3. **web_search** - Search for current market data
   - Use for: stock prices, exchange rates, current rates

## PANDAS TIPS:
- Access sheet: `sheets['Sheet Name']`
- Column names are in row 1 (headers), data starts row 2
- Common operations:
  - Sum: `sheets['Sheet']['Column'].sum()`
  - Average: `sheets['Sheet']['Column'].mean()`
  - Max: `sheets['Sheet']['Column'].max()`
  - Filter: `sheets['Sheet'][sheets['Sheet']['Column'] > 0]`
  - Percentage: `sheets['Sheet']['Column'] / sheets['Sheet']['Column'].sum() * 100`

## PRIVACY:
- Never include user's data in web searches
- Only search for public information (stock tickers, rates, etc.)
"""


TOOLS = [
    {
        "name": "execute_formula",
        "description": "Execute an Excel-style formula on the spreadsheet. Supports SUM, AVERAGE, COUNT, MAX, MIN, and cell references. Returns the computed result.",
        "input_schema": {
            "type": "object",
            "properties": {
                "formula": {
                    "type": "string",
                    "description": "The formula to execute, e.g., '=SUM(H2:H7)' or '=AVERAGE(E2:E10)'"
                },
                "sheet_name": {
                    "type": "string",
                    "description": "Name of the sheet to execute on. If omitted, uses first/only sheet."
                }
            },
            "required": ["formula"]
        }
    },
    {
        "name": "execute_pandas",
        "description": "Execute pandas code for complex queries. You have access to 'sheets' dict where keys are sheet names and values are DataFrames. Column names match the header row. Returns the computed result.",
        "input_schema": {
            "type": "object",
            "properties": {
                "code": {
                    "type": "string",
                    "description": "Python pandas expression to evaluate. Example: sheets['Sheet1']['Revenue'].sum()"
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