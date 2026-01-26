"""
Conversation Routes (Protected)
===============================
Enhanced with file association and visibility state persistence.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from typing import Optional
from datetime import datetime

from app.services.db import get_db
from app.services.auth import get_current_user
from app.models import User, Conversation, Message, Spreadsheet, ConversationFile

router = APIRouter(prefix="/conversations", tags=["conversations"])


# =============================================================================
# REQUEST/RESPONSE MODELS
# =============================================================================

class ConversationCreate(BaseModel):
    title: Optional[str] = "New Conversation"
    model: Optional[str] = None
    file_ids: Optional[list[str]] = None  # UUIDs of files to associate


class ConversationUpdate(BaseModel):
    title: Optional[str] = None
    model: Optional[str] = None


class FileVisibilityUpdate(BaseModel):
    """Update visibility state for a file in a conversation."""
    file_id: str
    visibility_state: dict  # { "SheetName": { "hiddenColumns": [...], ... } }


class MessageCreate(BaseModel):
    role: str
    content: str
    tool_calls: Optional[list[dict]] = None
    sources: Optional[list[dict]] = None
    followups: Optional[list[str]] = None
    selection_context: Optional[dict] = None


class MessageResponse(BaseModel):
    id: int
    role: str
    content: str
    tool_calls: Optional[list[dict]] = None
    sources: Optional[list[dict]] = None
    followups: Optional[list[str]] = None
    selection_context: Optional[dict] = None
    created_at: datetime

    class Config:
        from_attributes = True


class FileInConversation(BaseModel):
    file_id: str
    filename: str
    visibility_state: Optional[dict] = None
    added_at: datetime

    class Config:
        from_attributes = True


class ConversationResponse(BaseModel):
    id: int
    title: str
    model: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    message_count: int = 0
    file_count: int = 0

    class Config:
        from_attributes = True


class ConversationDetail(BaseModel):
    id: int
    title: str
    model: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    messages: list[MessageResponse]
    files: list[FileInConversation]

    class Config:
        from_attributes = True


# =============================================================================
# LIST CONVERSATIONS
# =============================================================================

@router.get("", response_model=list[ConversationResponse])
async def list_conversations(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List all conversations for the current user."""
    results = (
        db.query(
            Conversation,
            func.count(Message.id.distinct()).label('message_count'),
            func.count(ConversationFile.id.distinct()).label('file_count')
        )
        .outerjoin(Message, Message.conversation_id == Conversation.id)
        .outerjoin(ConversationFile, ConversationFile.conversation_id == Conversation.id)
        .filter(Conversation.user_id == current_user.id)
        .group_by(Conversation.id)
        .order_by(Conversation.updated_at.desc())
        .all()
    )
    
    return [
        ConversationResponse(
            id=conv.id,
            title=conv.title,
            model=conv.model,
            created_at=conv.created_at,
            updated_at=conv.updated_at,
            message_count=msg_count,
            file_count=file_count
        )
        for conv, msg_count, file_count in results
    ]


# =============================================================================
# CREATE CONVERSATION
# =============================================================================

@router.post("", response_model=ConversationDetail, status_code=status.HTTP_201_CREATED)
async def create_conversation(
    data: ConversationCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new conversation, optionally with associated files."""
    conv = Conversation(
        user_id=current_user.id,
        title=data.title or "New Conversation",
        model=data.model
    )
    db.add(conv)
    db.flush()  # Get the ID
    
    # Associate files if provided
    files_response = []
    if data.file_ids:
        for file_id in data.file_ids:
            spreadsheet = db.query(Spreadsheet).filter(
                Spreadsheet.file_id == file_id,
                Spreadsheet.user_id == current_user.id
            ).first()
            
            if spreadsheet:
                cf = ConversationFile(
                    conversation_id=conv.id,
                    spreadsheet_id=spreadsheet.id
                )
                db.add(cf)
                files_response.append(FileInConversation(
                    file_id=spreadsheet.file_id,
                    filename=spreadsheet.filename,
                    visibility_state=None,
                    added_at=cf.added_at or datetime.utcnow()
                ))
    
    db.commit()
    db.refresh(conv)
    
    return ConversationDetail(
        id=conv.id,
        title=conv.title,
        model=conv.model,
        created_at=conv.created_at,
        updated_at=conv.updated_at,
        messages=[],
        files=files_response
    )


# =============================================================================
# GET CONVERSATION
# =============================================================================

@router.get("/{conversation_id}", response_model=ConversationDetail)
async def get_conversation(
    conversation_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get a conversation with all messages and associated files."""
    conv = (
        db.query(Conversation)
        .options(
            joinedload(Conversation.messages),
            joinedload(Conversation.conversation_files).joinedload(ConversationFile.spreadsheet)
        )
        .filter(
            Conversation.id == conversation_id,
            Conversation.user_id == current_user.id
        )
        .first()
    )
    
    if not conv:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found"
        )
    
    # FIX: Sort by ID instead of created_at for consistent ordering
    # ID is guaranteed to be in insertion order, timestamps can have collisions
    return ConversationDetail(
        id=conv.id,
        title=conv.title,
        model=conv.model,
        created_at=conv.created_at,
        updated_at=conv.updated_at,
        messages=[
            MessageResponse(
                id=m.id,
                role=m.role,
                content=m.content,
                tool_calls=m.tool_calls,
                sources=m.sources,
                followups=m.followups,
                selection_context=m.selection_context,
                created_at=m.created_at
            )
            for m in sorted(conv.messages, key=lambda x: x.id)  # Sort by ID, not created_at
        ],
        files=[
            FileInConversation(
                file_id=cf.spreadsheet.file_id,
                filename=cf.spreadsheet.filename,
                visibility_state=cf.visibility_state,
                added_at=cf.added_at
            )
            for cf in conv.conversation_files
        ]
    )


# =============================================================================
# UPDATE CONVERSATION
# =============================================================================

@router.patch("/{conversation_id}", response_model=ConversationResponse)
async def update_conversation(
    conversation_id: int,
    data: ConversationUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update a conversation's title or model."""
    conv = db.query(Conversation).filter(
        Conversation.id == conversation_id,
        Conversation.user_id == current_user.id
    ).first()
    
    if not conv:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found"
        )
    
    if data.title is not None:
        conv.title = data.title
    if data.model is not None:
        conv.model = data.model
    
    conv.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(conv)
    
    # Get counts
    msg_count = db.query(func.count(Message.id)).filter(Message.conversation_id == conv.id).scalar()
    file_count = db.query(func.count(ConversationFile.id)).filter(ConversationFile.conversation_id == conv.id).scalar()
    
    return ConversationResponse(
        id=conv.id,
        title=conv.title,
        model=conv.model,
        created_at=conv.created_at,
        updated_at=conv.updated_at,
        message_count=msg_count,
        file_count=file_count
    )


# =============================================================================
# DELETE CONVERSATION
# =============================================================================

@router.delete("/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_conversation(
    conversation_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a conversation and all its messages."""
    conv = db.query(Conversation).filter(
        Conversation.id == conversation_id,
        Conversation.user_id == current_user.id
    ).first()
    
    if not conv:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found"
        )
    
    db.delete(conv)
    db.commit()


# =============================================================================
# FILE MANAGEMENT IN CONVERSATIONS
# =============================================================================

@router.post("/{conversation_id}/files/{file_id}")
async def add_file_to_conversation(
    conversation_id: int,
    file_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Add a spreadsheet file to a conversation."""
    conv = db.query(Conversation).filter(
        Conversation.id == conversation_id,
        Conversation.user_id == current_user.id
    ).first()
    
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    spreadsheet = db.query(Spreadsheet).filter(
        Spreadsheet.file_id == file_id,
        Spreadsheet.user_id == current_user.id
    ).first()
    
    if not spreadsheet:
        raise HTTPException(status_code=404, detail="File not found")
    
    # Check if already associated
    existing = db.query(ConversationFile).filter(
        ConversationFile.conversation_id == conv.id,
        ConversationFile.spreadsheet_id == spreadsheet.id
    ).first()
    
    if existing:
        return {"message": "File already in conversation", "file_id": file_id}
    
    cf = ConversationFile(
        conversation_id=conv.id,
        spreadsheet_id=spreadsheet.id
    )
    db.add(cf)
    db.commit()
    
    return {"message": "File added to conversation", "file_id": file_id}


@router.delete("/{conversation_id}/files/{file_id}")
async def remove_file_from_conversation(
    conversation_id: int,
    file_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Remove a file from a conversation."""
    conv = db.query(Conversation).filter(
        Conversation.id == conversation_id,
        Conversation.user_id == current_user.id
    ).first()
    
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    spreadsheet = db.query(Spreadsheet).filter(
        Spreadsheet.file_id == file_id,
        Spreadsheet.user_id == current_user.id
    ).first()
    
    if not spreadsheet:
        raise HTTPException(status_code=404, detail="File not found")
    
    cf = db.query(ConversationFile).filter(
        ConversationFile.conversation_id == conv.id,
        ConversationFile.spreadsheet_id == spreadsheet.id
    ).first()
    
    if cf:
        db.delete(cf)
        db.commit()
    
    return {"message": "File removed from conversation"}


# =============================================================================
# VISIBILITY STATE MANAGEMENT
# =============================================================================

@router.put("/{conversation_id}/visibility")
async def update_file_visibility(
    conversation_id: int,
    data: FileVisibilityUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update the visibility state for a file in a conversation."""
    conv = db.query(Conversation).filter(
        Conversation.id == conversation_id,
        Conversation.user_id == current_user.id
    ).first()
    
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    spreadsheet = db.query(Spreadsheet).filter(
        Spreadsheet.file_id == data.file_id,
        Spreadsheet.user_id == current_user.id
    ).first()
    
    if not spreadsheet:
        raise HTTPException(status_code=404, detail="File not found")
    
    cf = db.query(ConversationFile).filter(
        ConversationFile.conversation_id == conv.id,
        ConversationFile.spreadsheet_id == spreadsheet.id
    ).first()
    
    if not cf:
        # Auto-add file to conversation if not present
        cf = ConversationFile(
            conversation_id=conv.id,
            spreadsheet_id=spreadsheet.id,
            visibility_state=data.visibility_state
        )
        db.add(cf)
    else:
        cf.visibility_state = data.visibility_state
    
    db.commit()
    
    return {
        "message": "Visibility state updated",
        "file_id": data.file_id,
        "visibility_state": data.visibility_state
    }


@router.get("/{conversation_id}/visibility/{file_id}")
async def get_file_visibility(
    conversation_id: int,
    file_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get the visibility state for a file in a conversation."""
    conv = db.query(Conversation).filter(
        Conversation.id == conversation_id,
        Conversation.user_id == current_user.id
    ).first()
    
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    spreadsheet = db.query(Spreadsheet).filter(
        Spreadsheet.file_id == file_id
    ).first()
    
    if not spreadsheet:
        raise HTTPException(status_code=404, detail="File not found")
    
    cf = db.query(ConversationFile).filter(
        ConversationFile.conversation_id == conv.id,
        ConversationFile.spreadsheet_id == spreadsheet.id
    ).first()
    
    if not cf:
        return {"file_id": file_id, "visibility_state": None}
    
    return {
        "file_id": file_id,
        "visibility_state": cf.visibility_state
    }


# =============================================================================
# ADD MESSAGE TO CONVERSATION
# =============================================================================

@router.post("/{conversation_id}/messages", response_model=MessageResponse)
async def add_message(
    conversation_id: int,
    data: MessageCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Add a message to a conversation."""
    conv = db.query(Conversation).filter(
        Conversation.id == conversation_id,
        Conversation.user_id == current_user.id
    ).first()
    
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    msg = Message(
        conversation_id=conv.id,
        role=data.role,
        content=data.content,
        tool_calls=data.tool_calls,
        sources=data.sources,
        followups=data.followups,
        selection_context=data.selection_context
    )
    db.add(msg)
    
    # Update conversation timestamp
    conv.updated_at = datetime.utcnow()
    
    db.commit()
    db.refresh(msg)
    
    return MessageResponse(
        id=msg.id,
        role=msg.role,
        content=msg.content,
        tool_calls=msg.tool_calls,
        sources=msg.sources,
        followups=msg.followups,
        selection_context=msg.selection_context,
        created_at=msg.created_at
    )