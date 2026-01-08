"""
Chat Routes (Protected)
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session

from app.services.db import get_db
from app.services.auth import get_current_user
from app.services import ollama
from app.models import User, Conversation, Message

router = APIRouter(tags=["chat"])


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    model: Optional[str] = None
    conversation_id: Optional[int] = None


class ChatResponse(BaseModel):
    response: str
    model: str
    conversation_id: Optional[int] = None


@router.post("/chat", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    messages = [{"role": m.role, "content": m.content} for m in request.messages]
    result = await ollama.chat(messages, request.model)
    
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
        conversation_id=conversation_id
    )
