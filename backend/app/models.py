"""
Database Models for R-O-AI
==========================
Enhanced schema with conversation-file linking and visibility state persistence.
"""

from datetime import datetime
from typing import Optional
from sqlalchemy import (
    Column, Integer, String, Text, Boolean, DateTime, ForeignKey,
    LargeBinary, JSON, Table, UniqueConstraint
)
from sqlalchemy.orm import relationship, declarative_base
from sqlalchemy.sql import func

Base = declarative_base()


# =============================================================================
# USER MODEL
# =============================================================================

class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    
    # Relationships
    conversations = relationship("Conversation", back_populates="user", cascade="all, delete-orphan")
    spreadsheets = relationship("Spreadsheet", back_populates="user", cascade="all, delete-orphan")


# =============================================================================
# SPREADSHEET MODEL - Stores file data persistently
# =============================================================================

class Spreadsheet(Base):
    """
    Stores uploaded spreadsheet files with their raw bytes.
    Files can be associated with multiple conversations.
    """
    __tablename__ = "spreadsheets"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    file_id = Column(String(36), unique=True, index=True, nullable=False)  # UUID
    filename = Column(String(255), nullable=False)
    
    # Store raw file bytes for restoration
    file_data = Column(LargeBinary, nullable=True)
    
    # Sheet metadata as JSON
    sheet_info = Column(JSON, nullable=True)
    
    # File stats
    file_size = Column(Integer, nullable=True)  # bytes
    
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    
    # Relationships
    user = relationship("User", back_populates="spreadsheets")
    conversation_files = relationship("ConversationFile", back_populates="spreadsheet", cascade="all, delete-orphan")


# =============================================================================
# CONVERSATION MODEL
# =============================================================================

class Conversation(Base):
    """
    A chat conversation with associated files and messages.
    """
    __tablename__ = "conversations"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(255), default="New Conversation")
    
    # Optional: store the model used for this conversation
    model = Column(String(100), nullable=True)
    
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    
    # Relationships
    user = relationship("User", back_populates="conversations")
    messages = relationship("Message", back_populates="conversation", cascade="all, delete-orphan", order_by="Message.id")
    conversation_files = relationship("ConversationFile", back_populates="conversation", cascade="all, delete-orphan")
    
    @property
    def files(self):
        """Get all spreadsheet files associated with this conversation."""
        return [cf.spreadsheet for cf in self.conversation_files]


# =============================================================================
# MESSAGE MODEL
# =============================================================================

class Message(Base):
    """
    A single message in a conversation.
    Stores role, content, and optional metadata like tool calls.
    """
    __tablename__ = "messages"
    
    id = Column(Integer, primary_key=True, index=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False)
    
    role = Column(String(20), nullable=False)  # 'user' | 'assistant'
    content = Column(Text, nullable=False)
    
    # Optional: store tool calls and sources as JSON
    tool_calls = Column(JSON, nullable=True)  # List of tool call objects
    sources = Column(JSON, nullable=True)  # Web sources for citations
    followups = Column(JSON, nullable=True)  # Follow-up suggestions
    
    # Selection context if message was about specific cells
    selection_context = Column(JSON, nullable=True)
    
    created_at = Column(DateTime, server_default=func.now())
    
    # Relationships
    conversation = relationship("Conversation", back_populates="messages")


# =============================================================================
# CONVERSATION-FILE ASSOCIATION (Many-to-Many with visibility state)
# =============================================================================

class ConversationFile(Base):
    """
    Links a conversation to a spreadsheet file.
    Stores the visibility state (hidden columns/rows/cells) for this specific conversation.
    """
    __tablename__ = "conversation_files"
    
    id = Column(Integer, primary_key=True, index=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False)
    spreadsheet_id = Column(Integer, ForeignKey("spreadsheets.id", ondelete="CASCADE"), nullable=False)
    
    # Visibility state as JSON - structure:
    # {
    #     "SheetName": {
    #         "hiddenColumns": ["A", "B"],
    #         "hiddenRows": [1, 2, 3],
    #         "hiddenCells": ["C4", "D5"],
    #         "visibleColumns": [],
    #         "visibleRows": [],
    #         "visibleCells": []
    #     }
    # }
    visibility_state = Column(JSON, nullable=True)
    
    # Track when file was added to conversation
    added_at = Column(DateTime, server_default=func.now())
    
    # Unique constraint: one file per conversation
    __table_args__ = (
        UniqueConstraint('conversation_id', 'spreadsheet_id', name='uq_conversation_spreadsheet'),
    )
    
    # Relationships
    conversation = relationship("Conversation", back_populates="conversation_files")
    spreadsheet = relationship("Spreadsheet", back_populates="conversation_files")


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def create_tables(engine):
    """Create all tables in the database."""
    Base.metadata.create_all(bind=engine)


def drop_tables(engine):
    """Drop all tables (use with caution!)."""
    Base.metadata.drop_all(bind=engine)