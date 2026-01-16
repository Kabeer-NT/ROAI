"""
Chat Routes (Protected) - WITH VISIBILITY SUPPORT, FOLLOW-UPS, AND WEB SOURCES
===============================================================================
Features:
- Follow-up suggestions after every response
- Better error handling with friendly messages
- Web search source citations for transparency
- Selection context for focused cell analysis
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional, Any
from sqlalchemy.orm import Session

from app.services.db import get_db
from app.services.auth import get_current_user
from app.services import claude as claude 
from app.services.spreadsheet import (
    build_llm_context, 
    spreadsheet_context, 
    list_available_files, 
    extract_context_for_errors, 
    friendly_error_response
)
from app.services.suggestions import generate_followups  # Updated import
from app.services.prompts import get_friendly_error
from app.models import User, Conversation, Message

router = APIRouter(tags=["chat"])


# =============================================================================
# REQUEST/RESPONSE MODELS
# =============================================================================

class ChatMessage(BaseModel):
    role: str
    content: str


class SheetVisibility(BaseModel):
    """Visibility settings for a single sheet."""
    hiddenColumns: list[str] = []
    hiddenRows: list[int] = []
    hiddenCells: list[str] = []


class SelectionContext(BaseModel):
    """Context about user's selected cells in the spreadsheet."""
    sheetName: str
    startCell: str
    endCell: str
    cells: list[str] = []
    rangeString: str  # e.g., "A1:B5" or "A1" for single cell


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    model: Optional[str] = None
    conversation_id: Optional[int] = None
    visibility: Optional[dict[str, dict[str, dict]]] = None
    include_followups: bool = True
    selection_context: Optional[SelectionContext] = None  # NEW: Selected cells context


class WebSource(BaseModel):
    """A web source citation from search results."""
    url: str
    title: str = ""
    snippet: str = ""


class ToolCall(BaseModel):
    type: str
    formula: Optional[str] = None
    code: Optional[str] = None
    query: Optional[str] = None
    sheet: Optional[str] = None
    result: Any
    sources: list[WebSource] = []  # Sources for web_search type


class FollowupSuggestion(BaseModel):
    text: str
    type: str = "followup"


class ChatResponse(BaseModel):
    response: str
    model: str
    conversation_id: Optional[int] = None
    tool_calls: list[ToolCall] = []
    followups: list[FollowupSuggestion] = []
    sources: list[WebSource] = []  # Top-level sources for easy access
    error: Optional[dict] = None


# =============================================================================
# MAIN CHAT ENDPOINT
# =============================================================================

@router.post("/chat", response_model=ChatResponse)
async def chat_endpoint(
    request: ChatRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    messages = [{"role": m.role, "content": m.content} for m in request.messages]
    user_question = request.messages[-1].content if request.messages else ""
    
    try:
        # Build selection context hint for Claude if provided
        selection_hint = None
        if request.selection_context:
            sc = request.selection_context
            selection_hint = {
                "sheet": sc.sheetName,
                "range": sc.rangeString,
                "cells": sc.cells,
            }
        
        # Call Claude with visibility settings and selection context
        result = await claude.chat(
            messages, 
            request.model,
            visibility=request.visibility,
            selection_context=selection_hint
        )
        
        response_text = result.get("response", "")
        
        # Check for errors from Claude
        if result.get("error"):
            error_type = result.get("error", "unknown")
            friendly = get_friendly_error(error_type)
            
            return ChatResponse(
                response=friendly["message"],
                model=result.get("model", "unknown"),
                conversation_id=request.conversation_id,
                tool_calls=[],
                followups=[FollowupSuggestion(text=s) for s in friendly.get("suggestions", [])],
                sources=[],
                error=friendly
            )
        
        # Extract sources from result
        raw_sources = result.get("sources", [])
        sources = [
            WebSource(
                url=s.get("url", ""),
                title=s.get("title", ""),
                snippet=s.get("snippet", "")
            )
            for s in raw_sources
        ]
        
        # Convert tool_calls with sources
        tool_calls = []
        for tc in result.get("tool_calls", []):
            tc_sources = [
                WebSource(
                    url=s.get("url", ""),
                    title=s.get("title", ""),
                    snippet=s.get("snippet", "")
                )
                for s in tc.get("sources", [])
            ]
            
            tool_calls.append(ToolCall(
                type=tc.get("type", "unknown"),
                formula=tc.get("formula"),
                code=tc.get("code"),
                query=tc.get("query"),
                sheet=tc.get("sheet"),
                result=tc.get("result"),
                sources=tc_sources
            ))
        
        # Generate follow-up suggestions
        followups = []
        if request.include_followups and response_text:
            try:
                ss_context = build_llm_context(visibility=request.visibility)
                
                # Include selection context in followup generation
                followup_context = ss_context
                if request.selection_context:
                    followup_context += f"\n[User was asking about cells {request.selection_context.rangeString} on sheet \"{request.selection_context.sheetName}\"]"
                
                followup_result = await generate_followups(
                    user_question,
                    response_text,
                    followup_context
                )
                
                followups = [
                    FollowupSuggestion(text=f)
                    for f in followup_result.get("followups", [])
                ]
            except Exception as e:
                print(f"Followup generation failed: {e}")
                # Don't fail the whole request, just skip followups
        
        # Save to conversation if provided
        conversation_id = request.conversation_id
        if conversation_id:
            conv = db.query(Conversation).filter(
                Conversation.id == conversation_id,
                Conversation.user_id == current_user.id
            ).first()
            
            if conv:
                user_msg = Message(
                    conversation_id=conv.id,
                    role="user",
                    content=user_question
                )
                db.add(user_msg)
                
                assistant_msg = Message(
                    conversation_id=conv.id,
                    role="assistant",
                    content=response_text
                )
                db.add(assistant_msg)
                db.commit()
        
        return ChatResponse(
            response=response_text,
            model=result.get("model", "unknown"),
            conversation_id=conversation_id,
            tool_calls=tool_calls,
            followups=followups,
            sources=sources
        )
    
    except Exception as e:
        print(f"Chat error: {e}")
        
        # Return friendly error
        files = list_available_files()
        file_id = files[0]["file_id"] if files else None
        
        context = {}
        if file_id:
            context = extract_context_for_errors(file_id)
        
        friendly = friendly_error_response(e, context)
        
        return ChatResponse(
            response=friendly["message"],
            model="error",
            conversation_id=request.conversation_id,
            tool_calls=[],
            followups=[FollowupSuggestion(text=s) for s in friendly.get("suggestions", []) if s],
            sources=[],
            error=friendly
        )


# =============================================================================
# QUICK CHAT - Simpler endpoint for one-off questions
# =============================================================================

class QuickChatRequest(BaseModel):
    question: str
    file_id: Optional[str] = None
    selection_context: Optional[SelectionContext] = None  # NEW


class QuickChatResponse(BaseModel):
    answer: str
    followups: list[str] = []
    sources: list[WebSource] = []  # Include sources here too


@router.post("/chat/quick", response_model=QuickChatResponse)
async def quick_chat(
    request: QuickChatRequest,
    current_user: User = Depends(get_current_user),
):
    """
    Simpler chat endpoint for quick questions.
    Doesn't save to conversation history.
    """
    try:
        # Build selection hint if provided
        selection_hint = None
        if request.selection_context:
            sc = request.selection_context
            selection_hint = {
                "sheet": sc.sheetName,
                "range": sc.rangeString,
                "cells": sc.cells,
            }
        
        result = await claude.chat(
            messages=[{"role": "user", "content": request.question}],
            model=None,
            visibility=None,
            selection_context=selection_hint
        )
        
        answer = result.get("response", "")
        
        # Extract sources
        raw_sources = result.get("sources", [])
        sources = [
            WebSource(
                url=s.get("url", ""),
                title=s.get("title", ""),
                snippet=s.get("snippet", "")
            )
            for s in raw_sources
        ]
        
        # Generate followups
        followups = []
        try:
            followup_result = await generate_followups(request.question, answer, "")
            followups = followup_result.get("followups", [])
        except:
            pass
        
        return QuickChatResponse(
            answer=answer,
            followups=followups,
            sources=sources
        )
    
    except Exception as e:
        return QuickChatResponse(
            answer="Sorry, something went wrong. Try asking a different way.",
            followups=["What are the totals?", "Show me a summary"],
            sources=[]
        )