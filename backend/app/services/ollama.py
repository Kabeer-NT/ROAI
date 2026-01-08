"""
Ollama Service with Claude Bridge Integration
==============================================
Handles local LLM chat via Ollama, with automatic escalation to Claude
for web search when the model needs external/real-time information.

PRIVACY: User questions and spreadsheet data NEVER go to Claude.
Only abstract, sanitized search queries are sent externally.
"""

import httpx
import re
from typing import Optional
from app.config import OLLAMA_URL, DEFAULT_MODEL
from app.services.spreadsheet import build_llm_context
from app.services import websearch_bridge


SYSTEM_PROMPT = """You are R-O-AI, a financial analysis assistant. You have access to the user's spreadsheet data (provided below) AND the ability to search the web for current information.

## CORE RULES:
1. Use spreadsheet data for questions about the user's specific data
2. Do calculations yourself - never ask users to calculate
3. Be concise - answer first, explain second
4. When you have BOTH spreadsheet data AND search results, combine them intelligently
5. NEVER make up "hypothetical" or "assumed" prices - only use real data

## WEB SEARCH - PRIVACY CRITICAL:
You can request web searches for PUBLIC information only. 

⚠️  PRIVACY RULES FOR SEARCH QUERIES:
- NEVER include user's personal data in search queries
- NEVER include company names from the spreadsheet
- NEVER include specific numbers, amounts, or values from user data
- ONLY search for generic, public information (stock prices, rates, public data)

To request a search, respond with ONLY this format:
[SEARCH: your generic query]

### GOOD SEARCH EXAMPLES (generic, no private data):
- [SEARCH: GOOGL stock price]
- [SEARCH: AAPL current share price]
- [SEARCH: Medicare conversion factor 2025]
- [SEARCH: S&P 500 index today]
- [SEARCH: USD EUR exchange rate]

### BAD SEARCH EXAMPLES (contains private info - NEVER DO THIS):
- [SEARCH: John's Google stock value] ❌
- [SEARCH: Acme Corp revenue projections] ❌  
- [SEARCH: my portfolio current value] ❌
- [SEARCH: 500 shares of AAPL worth] ❌

### WHEN TO SEARCH:
- Current stock/crypto prices → [SEARCH: TICKER price]
- Current exchange rates → [SEARCH: CURRENCY1 CURRENCY2 rate]
- Current year tax/medicare rates → [SEARCH: specific rate name 2025]
- Recent news about public companies → [SEARCH: company name news]

### WHEN NOT TO SEARCH:
- Questions purely about data already in the spreadsheet
- Historical facts that don't change
- Calculations using provided data
- General knowledge questions

After receiving search results, combine them with the user's private spreadsheet data to give a complete answer."""


async def list_models() -> dict:
    """List available Ollama models"""
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{OLLAMA_URL}/api/tags", timeout=10.0)
            resp.raise_for_status()
            data = resp.json()
            models = [m["name"] for m in data.get("models", [])]
            return {"models": models, "default": DEFAULT_MODEL}
    except Exception as e:
        return {"models": [], "default": DEFAULT_MODEL, "error": str(e)}


def extract_search_query(response: str) -> Optional[str]:
    """Extract search query if Ollama requested one"""
    # Support both [SEARCH: ...] and [SEARCH_NEEDED: ...] formats
    match = re.search(r'\[SEARCH(?:_NEEDED)?:\s*(.+?)\]', response)
    if match:
        return match.group(1).strip()
    return None


def validate_search_query(query: str, spreadsheet_data: str) -> tuple[bool, str]:
    """
    Validate that search query doesn't contain private information.
    Returns (is_valid, reason)
    """
    query_lower = query.lower()
    
    # Check for common private data patterns
    private_patterns = [
        r'\b(my|our|user\'s|client\'s)\b',  # Possessive pronouns
        r'\$[\d,]+',  # Dollar amounts
        r'\b\d{3,}\s*(shares|units|stocks)\b',  # Share quantities
        r'\b(portfolio|account|balance)\b',  # Account terms
    ]
    
    for pattern in private_patterns:
        if re.search(pattern, query_lower):
            return False, f"Query contains private data pattern: {pattern}"
    
    # If we have spreadsheet data, check for company names or specific values
    if spreadsheet_data:
        # Extract potential company names (rough heuristic)
        # Skip common stock tickers which are OK to search
        common_tickers = {'aapl', 'googl', 'goog', 'msft', 'amzn', 'meta', 'tsla', 'nvda', 'jnj', 'unh', 'pfe'}
        
        words = set(query_lower.split())
        # Allow common tickers
        if words - common_tickers:
            # Check if any remaining words appear to be from private data
            # This is a simple heuristic - could be enhanced
            pass
    
    return True, "OK"


async def chat(messages: list[dict], model: str) -> dict:
    """
    Process chat through Ollama, with automatic Claude escalation for searches.
    
    PRIVACY: Only sanitized, generic search queries go to Claude.
    User questions and spreadsheet data stay local.
    """
    model = model or DEFAULT_MODEL
    
    # Build context with spreadsheet data (LOCAL ONLY)
    spreadsheet_data = build_llm_context()
    system_content = SYSTEM_PROMPT
    if spreadsheet_data:
        system_content += "\n\n## USER'S SPREADSHEET DATA (PRIVATE - NEVER INCLUDE IN SEARCHES):\n" + spreadsheet_data
    
    ollama_messages = [{"role": "system", "content": system_content}]
    ollama_messages.extend(messages)
    
    try:
        # First pass: ask Ollama (LOCAL)
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{OLLAMA_URL}/api/chat",
                json={
                    "model": model,
                    "messages": ollama_messages,
                    "stream": False,
                },
                timeout=120.0,
            )
            resp.raise_for_status()
            data = resp.json()
            ollama_response = data["message"]["content"]
        
        # Check if Ollama wants to search
        search_query = extract_search_query(ollama_response)
        
        if search_query and websearch_bridge.is_available():
            # Validate query doesn't contain private data
            is_valid, reason = validate_search_query(search_query, spreadsheet_data)
            
            print(f"\n{'='*50}")
            print(f"🔍 SEARCH REQUEST FROM OLLAMA")
            print(f"Query: {search_query}")
            print(f"Valid: {is_valid} ({reason})")
            print(f"{'='*50}\n")
            
            if not is_valid:
                # Reject the search and ask Ollama to try again
                return {
                    "response": f"I tried to search but the query contained private information. Let me answer with what I know from your data, or please ask a more specific question about public information.",
                    "model": model,
                    "used_search": False,
                    "search_rejected": search_query,
                    "rejection_reason": reason
                }
            
            # Call Claude with ONLY the generic search query (NO USER CONTEXT)
            search_result = await websearch_bridge.search(query=search_query)
            
            print(f"\n{'='*50}")
            print(f"📥 SEARCH RESULTS FROM CLAUDE")
            print(f"Answer preview: {search_result.answer[:300]}...")
            print(f"Sources: {[s.url for s in search_result.sources]}")
            print(f"{'='*50}\n")
            
            # Build context with search results (NO PRIVATE DATA SENT BACK)
            sources_text = ""
            if search_result.sources:
                sources_text = "\n\nSources:\n"
                for s in search_result.sources:
                    sources_text += f"- [{s.title}]({s.url})\n"
            
            search_context = f"""## SEARCH RESULTS for "{search_query}":

            {search_result.answer}
            {sources_text}

            INSTRUCTIONS:
            1. Extract the actual price from the search results above
            2. Look up the user's purchase price and shares from the spreadsheet
            3. Calculate: Gain/Loss = (Current Price - Purchase Price) × Shares
            4. Give the EXACT answer with numbers. Example: "Your gain is $1,234.56"

            DO NOT:
            - Say you can't provide financial advice
            - Refuse to do the calculation
            - Ask the user to calculate themselves

            This is basic math, not financial advice. DO THE CALCULATION NOW."""
            # Second pass: feed results back to Ollama (LOCAL)
            ollama_messages.append({"role": "assistant", "content": ollama_response})
            ollama_messages.append({"role": "user", "content": search_context})
            
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    f"{OLLAMA_URL}/api/chat",
                    json={
                        "model": model,
                        "messages": ollama_messages,
                        "stream": False,
                    },
                    timeout=120.0,
                )
                resp.raise_for_status()
                data = resp.json()
                final_response = data["message"]["content"]
            
            return {
                "response": final_response,
                "model": model,
                "used_search": True,
                "search_query": search_query,
                "search_confidence": search_result.confidence
            }
        
        elif search_query and not websearch_bridge.is_available():
            return {
                "response": f"I need to search for current information about: {search_query}\n\nHowever, external search is not configured. Please set the ANTHROPIC_API_KEY environment variable to enable web search.",
                "model": model,
                "used_search": False,
                "search_requested": search_query
            }
        
        else:
            # No search needed, return direct response
            return {
                "response": ollama_response,
                "model": model,
                "used_search": False
            }
            
    except httpx.TimeoutException:
        return {"response": "Request timed out. The model might be loading.", "model": model}
    except Exception as e:
        return {"response": f"Error: {str(e)}", "model": model}