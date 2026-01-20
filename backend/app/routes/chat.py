"""
Chat Routes (Protected) - WITH CONVERSATION PERSISTENCE
========================================================
Features:
- Auto-creates conversation if none provided
- Saves all messages to database
- Loads conversation files into memory on demand
- Follow-up suggestions and web sources
- Selection context for focused cell analysis
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, Any
from sqlalchemy.orm import Session
from datetime import datetime

from app.services.db import get_db
from app.services.auth import get_current_user
from app.services import claude
from app.services.spreadsheet import (
    build_llm_context,
    spreadsheet_context,
    list_available_files,
    extract_context_for_errors,
    friendly_error_response,
    restore_file_from_bytes,
    is_file_loaded,
)
from app.services.suggestions import generate_followups
from app.services.prompts import get_friendly_error
from app.models import User, Conversation, Message, ConversationFile, Spreadsheet

router = APIRouter(tags=["chat"])


# =============================================================================
# REQUEST/RESPONSE MODELS
# =============================================================================

class ChatMessage(BaseModel):
    role: str
    content: str


class SheetVisibility(BaseModel):
    hiddenColumns: list[str] = []
    hiddenRows: list[int] = []
    hiddenCells: list[str] = []


class SelectionContext(BaseModel):
    sheetName: str
    startCell: str
    endCell: str
    cells: list[str] = []
    rangeString: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    model: Optional[str] = None
    conversation_id: Optional[int] = None
    visibility: Optional[dict[str, dict[str, dict]]] = None
    include_followups: bool = True
    selection_context: Optional[SelectionContext] = None
    # NEW: Auto-create conversation if not provided
    auto_create_conversation: bool = True


class WebSource(BaseModel):
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
    sources: list[WebSource] = []


class FollowupSuggestion(BaseModel):
    text: str
    type: str = "followup"


class ChatResponse(BaseModel):
    response: str
    model: str
    conversation_id: Optional[int] = None
    tool_calls: list[ToolCall] = []
    followups: list[FollowupSuggestion] = []
    sources: list[WebSource] = []
    error: Optional[dict] = None


# =============================================================================
# HELPER: Load conversation files into memory
# =============================================================================

def load_conversation_files(conv: Conversation, db: Session) -> list[dict]:
    """Load all files associated with a conversation into memory."""
    loaded = []
    
    for cf in conv.conversation_files:
        ss = cf.spreadsheet
        
        # Skip if already loaded
        if is_file_loaded(ss.file_id):
            loaded.append({
                "file_id": ss.file_id,
                "filename": ss.filename,
                "status": "already_loaded"
            })
            continue
        
        # Restore from database
        if ss.file_data:
            try:
                restore_file_from_bytes(ss.file_id, ss.filename, ss.file_data, ss.sheet_info)
                loaded.append({
                    "file_id": ss.file_id,
                    "filename": ss.filename,
                    "status": "restored"
                })
            except Exception as e:
                loaded.append({
                    "file_id": ss.file_id,
                    "filename": ss.filename,
                    "status": "error",
                    "error": str(e)
                })
        else:
            loaded.append({
                "file_id": ss.file_id,
                "filename": ss.filename,
                "status": "no_data"
            })
    
    return loaded


def get_conversation_visibility(conv: Conversation) -> dict:
    """Get merged visibility settings for all files in a conversation."""
    visibility = {}
    
    for cf in conv.conversation_files:
        if cf.visibility_state:
            visibility[cf.spreadsheet.filename] = cf.visibility_state
    
    return visibility


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
        conv = None
        conversation_id = request.conversation_id
        
        # Get or create conversation
        if conversation_id:
            conv = db.query(Conversation).filter(
                Conversation.id == conversation_id,
                Conversation.user_id == current_user.id
            ).first()
            
            if not conv:
                raise HTTPException(status_code=404, detail="Conversation not found")
            
            # Load conversation files into memory
            load_conversation_files(conv, db)
            
        elif request.auto_create_conversation:
            # Auto-create a new conversation
            # Generate title from first message
            title = user_question[:50] + "..." if len(user_question) > 50 else user_question
            title = title or "New Conversation"
            
            conv = Conversation(
                user_id=current_user.id,
                title=title,
                model=request.model
            )
            db.add(conv)
            db.flush()
            conversation_id = conv.id
        
        # Merge visibility: use request visibility, falling back to conversation visibility
        visibility = request.visibility
        if not visibility and conv:
            visibility = get_conversation_visibility(conv)
        
        # Build selection context hint
        selection_hint = None
        if request.selection_context:
            sc = request.selection_context
            selection_hint = {
                "sheet": sc.sheetName,
                "range": sc.rangeString,
                "cells": sc.cells,
            }
        
        # Call Claude
        result = await claude.chat(
            messages,
            request.model,
            visibility=visibility,
            selection_context=selection_hint
        )
        
        response_text = result.get("response", "")
        
        # Check for errors
        if result.get("error"):
            error_type = result.get("error", "unknown")
            friendly = get_friendly_error(error_type)
            
            return ChatResponse(
                response=friendly["message"],
                model=result.get("model", "unknown"),
                conversation_id=conversation_id,
                tool_calls=[],
                followups=[FollowupSuggestion(text=s) for s in friendly.get("suggestions", [])],
                sources=[],
                error=friendly
            )
        
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
        
        # Convert tool calls
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
        
        # Generate follow-ups
        followups = []
        if request.include_followups and response_text:
            try:
                ss_context = build_llm_context(visibility=visibility)
                
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
        
        # Save messages to conversation
        if conv:
            # Save user message
            user_msg = Message(
                conversation_id=conv.id,
                role="user",
                content=user_question,
                selection_context=request.selection_context.model_dump() if request.selection_context else None
            )
            db.add(user_msg)
            
            # Save assistant message
            assistant_msg = Message(
                conversation_id=conv.id,
                role="assistant",
                content=response_text,
                tool_calls=[tc.model_dump() for tc in tool_calls] if tool_calls else None,
                sources=[s.model_dump() for s in sources] if sources else None,
                followups=[f.text for f in followups] if followups else None
            )
            db.add(assistant_msg)
            
            # Update conversation timestamp
            conv.updated_at = datetime.utcnow()
            
            db.commit()
        
        return ChatResponse(
            response=response_text,
            model=result.get("model", "unknown"),
            conversation_id=conversation_id,
            tool_calls=tool_calls,
            followups=followups,
            sources=sources
        )
    
    except HTTPException:
        raise
    except Exception as e:
        print(f"Chat error: {e}")
        import traceback
        traceback.print_exc()
        
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
# LOAD CONVERSATION ENDPOINT
# =============================================================================

@router.post("/chat/load/{conversation_id}")
async def load_conversation(
    conversation_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Load a conversation's files into memory.
    Call this when switching to a conversation.
    """
    conv = db.query(Conversation).filter(
        Conversation.id == conversation_id,
        Conversation.user_id == current_user.id
    ).first()
    
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    loaded = load_conversation_files(conv, db)
    
    return {
        "conversation_id": conversation_id,
        "files_loaded": loaded
    }


# =============================================================================
# QUICK CHAT - Simpler endpoint
# =============================================================================

class QuickChatRequest(BaseModel):
    question: str
    file_id: Optional[str] = None
    selection_context: Optional[SelectionContext] = None


class QuickChatResponse(BaseModel):
    answer: str
    followups: list[str] = []
    sources: list[WebSource] = []


@router.post("/chat/quick", response_model=QuickChatResponse)
async def quick_chat(
    request: QuickChatRequest,
    current_user: User = Depends(get_current_user),
):
    """Quick chat without conversation persistence."""
    try:
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
        
        raw_sources = result.get("sources", [])
        sources = [
            WebSource(
                url=s.get("url", ""),
                title=s.get("title", ""),
                snippet=s.get("snippet", "")
            )
            for s in raw_sources
        ]
        
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