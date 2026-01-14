"""
Chat Routes (Protected) - WITH VISIBILITY SUPPORT
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional, Any
from sqlalchemy.orm import Session

from app.services.db import get_db
from app.services.auth import get_current_user
from app.services import claude
from app.models import User, Conversation, Message

router = APIRouter(tags=["chat"])


class ChatMessage(BaseModel):
    role: str
    content: str


# ============================================================================
# Visibility Types - Sheet-Scoped
# ============================================================================

class SheetVisibility(BaseModel):
    """Visibility settings for a single sheet."""
    hiddenColumns: list[str] = []
    hiddenRows: list[int] = []
    hiddenCells: list[str] = []


# FileVisibility is a dict of sheet_name -> SheetVisibility
# We use dict[str, SheetVisibility] but Pydantic needs special handling
# So we'll accept dict[str, dict] and validate manually


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    model: Optional[str] = None
    conversation_id: Optional[int] = None
    # NEW: Visibility settings (sheet-scoped)
    # Format: { "filename.xlsx": { "Sheet1": { hiddenColumns: [...], ... }, "Sheet2": {...} } }
    visibility: Optional[dict[str, dict[str, dict]]] = None


class ToolCall(BaseModel):
    type: str
    formula: Optional[str] = None
    code: Optional[str] = None
    query: Optional[str] = None
    sheet: Optional[str] = None
    result: Any


class ChatResponse(BaseModel):
    response: str
    model: str
    conversation_id: Optional[int] = None
    tool_calls: list[ToolCall] = []


@router.post("/chat", response_model=ChatResponse)
async def chat_endpoint(
    request: ChatRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    messages = [{"role": m.role, "content": m.content} for m in request.messages]
    
    # FIX: Pass visibility to claude.chat()
    result = await claude.chat(
        messages, 
        request.model,
        visibility=request.visibility  # NEW: Pass visibility settings
    )
    
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
                content=request.messages[-1].content
            )
            db.add(user_msg)
            
            assistant_msg = Message(
                conversation_id=conv.id,
                role="assistant",
                content=result["response"]
            )
            db.add(assistant_msg)
            db.commit()
    
    return ChatResponse(
        response=result["response"],
        model=result["model"],
        conversation_id=conversation_id,
        tool_calls=result.get("tool_calls", [])
    )