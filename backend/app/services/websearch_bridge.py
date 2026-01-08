"""
Websearch Bridge Service
========================
Handles external searches via Claude API when Ollama needs real-time data.
"""

import httpx
import re
from typing import Optional
from dataclasses import dataclass, asdict
from datetime import datetime
import logging

from app.config import ANTHROPIC_API_KEY

logger = logging.getLogger(__name__)

# Configuration
CLAUDE_MODEL = "claude-sonnet-4-20250514"
ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"


@dataclass
class Source:
    """A cited source from web search"""
    url: str
    title: str
    domain_tier: int  # 1=gov/peer-reviewed, 2=professional assoc, 3=news/other
    
    @staticmethod
    def classify_domain(url: str) -> int:
        """Classify source credibility based on domain"""
        url_lower = url.lower()
        
        # Tier 1: Government and peer-reviewed
        tier1 = ['.gov', 'pubmed', 'nih.gov', 'cms.gov', 'ahrq.gov', 'cdc.gov', '.edu']
        if any(d in url_lower for d in tier1):
            return 1
        
        # Tier 2: Professional associations
        tier2 = ['mgma.com', 'ama-assn.org', 'aafp.org', 'acc.org', 'healthaffairs.org', 'finance.yahoo', 'reuters', 'bloomberg']
        if any(d in url_lower for d in tier2):
            return 2
        
        return 3


@dataclass
class SearchResult:
    """Structured response from Claude search"""
    answer: str
    sources: list[Source]
    confidence: str  # high, medium, low
    timestamp: str
    raw_query: str
    
    def to_dict(self) -> dict:
        return {
            "answer": self.answer,
            "sources": [asdict(s) for s in self.sources],
            "confidence": self.confidence,
            "timestamp": self.timestamp,
            "raw_query": self.raw_query
        }


CLAUDE_SYSTEM_PROMPT = """You are a research assistant for a financial analysis system (ROAI).

Your role is to answer questions with accurate, well-sourced information.

RULES:
1. Search the web for current information
2. Always include the source URLs in your response
3. Format sources as: [Source Title](URL)
4. Be explicit about uncertainty
5. If you cannot find credible sources, say so

IMPORTANT: Always include clickable markdown links to your sources like this:
- [Yahoo Finance](https://finance.yahoo.com/quote/GOOGL)
- [CMS.gov](https://www.cms.gov/...)

Be concise and factual."""


def extract_urls_from_text(text: str) -> list[tuple[str, str]]:
    """Extract markdown links and plain URLs from text"""
    sources = []
    
    # Match markdown links: [title](url)
    md_pattern = r'\[([^\]]+)\]\((https?://[^\)]+)\)'
    for match in re.finditer(md_pattern, text):
        title, url = match.groups()
        sources.append((title, url))
    
    # Match plain URLs not already in markdown
    url_pattern = r'(?<!\()(https?://[^\s\)\]]+)'
    for match in re.finditer(url_pattern, text):
        url = match.group(1)
        # Skip if this URL is already captured in markdown
        if not any(url in s[1] for s in sources):
            # Extract domain as title
            domain = re.search(r'https?://(?:www\.)?([^/]+)', url)
            title = domain.group(1) if domain else url
            sources.append((title, url))
    
    return sources


async def search(query: str, context: Optional[str] = None) -> SearchResult:
    """
    Send a query to Claude with web search enabled.
    
    Args:
        query: The question to answer
        context: Optional context about why this is being asked
        
    Returns:
        SearchResult with answer, sources, and metadata
    """
    if not ANTHROPIC_API_KEY:
        logger.error("ANTHROPIC_API_KEY not set")
        return SearchResult(
            answer="Error: Claude API key not configured. Set ANTHROPIC_API_KEY environment variable.",
            sources=[],
            confidence="none",
            timestamp=datetime.utcnow().isoformat(),
            raw_query=query
        )
    
    user_message = query
    if context:
        user_message = f"Context: {context}\n\nQuestion: {query}"
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                ANTHROPIC_API_URL,
                headers={
                    "Content-Type": "application/json",
                    "x-api-key": ANTHROPIC_API_KEY,
                    "anthropic-version": "2023-06-01"
                },
                json={
                    "model": CLAUDE_MODEL,
                    "max_tokens": 4096,
                    "system": CLAUDE_SYSTEM_PROMPT,
                    "tools": [{
                        "type": "web_search_20250305",
                        "name": "web_search"
                    }],
                    "messages": [
                        {"role": "user", "content": user_message}
                    ]
                },
                timeout=60.0
            )
            response.raise_for_status()
            data = response.json()
            
            # Log raw response for debugging
            logger.info(f"Claude response: {data}")
            
            # Extract answer text and sources
            answer_text = ""
            sources = []
            seen_urls = set()
            
            for block in data.get("content", []):
                if block.get("type") == "text":
                    text = block.get("text", "")
                    answer_text += text
                    
                    # Extract URLs from text
                    for title, url in extract_urls_from_text(text):
                        if url not in seen_urls:
                            seen_urls.add(url)
                            sources.append(Source(
                                url=url,
                                title=title,
                                domain_tier=Source.classify_domain(url)
                            ))
                    
                    # Check for citations in the block
                    if "citations" in block:
                        for cite in block.get("citations", []):
                            url = cite.get("url", "")
                            if url and url not in seen_urls:
                                seen_urls.add(url)
                                sources.append(Source(
                                    url=url,
                                    title=cite.get("title", url),
                                    domain_tier=Source.classify_domain(url)
                                ))
                
                # Handle web search results block
                elif block.get("type") == "tool_result" or block.get("type") == "web_search_tool_result":
                    content = block.get("content", [])
                    if isinstance(content, list):
                        for item in content:
                            if isinstance(item, dict):
                                url = item.get("url", "")
                                if url and url not in seen_urls:
                                    seen_urls.add(url)
                                    sources.append(Source(
                                        url=url,
                                        title=item.get("title", url),
                                        domain_tier=Source.classify_domain(url)
                                    ))
            
            # Determine confidence based on sources
            if any(s.domain_tier == 1 for s in sources):
                confidence = "high"
            elif any(s.domain_tier == 2 for s in sources):
                confidence = "medium"
            elif sources:
                confidence = "low"
            else:
                confidence = "low"
            
            return SearchResult(
                answer=answer_text,
                sources=sources,
                confidence=confidence,
                timestamp=datetime.utcnow().isoformat(),
                raw_query=query
            )
            
    except httpx.TimeoutException:
        logger.error("Claude API timeout")
        return SearchResult(
            answer="Search timed out. Please try again.",
            sources=[],
            confidence="none",
            timestamp=datetime.utcnow().isoformat(),
            raw_query=query
        )
    except httpx.HTTPStatusError as e:
        logger.error(f"Claude API error: {e.response.status_code} - {e.response.text}")
        return SearchResult(
            answer=f"Search error: {e.response.status_code}",
            sources=[],
            confidence="none",
            timestamp=datetime.utcnow().isoformat(),
            raw_query=query
        )
    except Exception as e:
        logger.error(f"Claude search failed: {e}")
        return SearchResult(
            answer=f"Search failed: {str(e)}",
            sources=[],
            confidence="none",
            timestamp=datetime.utcnow().isoformat(),
            raw_query=query
        )


def is_available() -> bool:
    """Check if Claude bridge is configured"""
    return bool(ANTHROPIC_API_KEY)