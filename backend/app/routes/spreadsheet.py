"""
Spreadsheet Routes (Protected)
==============================
Files are stored persistently in the database and can be associated with conversations.
CONVERSATION-SCOPED: Only loads files to memory if conversation is active.
"""

from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
import pandas as pd
import io
import uuid
import json

from app.services.db import get_db
from app.services.auth import get_current_user
from app.services.spreadsheet import (
    spreadsheet_context,
    add_file_to_context,
    remove_file_from_context,
    execute_formula,
    execute_python_query,
    list_available_files,
    friendly_error_response,
    extract_context_for_errors,
    is_file_loaded,
    restore_file_from_bytes,
)
from app.models import User, Spreadsheet, Conversation, ConversationFile

# Import conversation tracking from chat routes
from app.routes.chat import get_current_loaded_conversation

router = APIRouter(tags=["spreadsheet"])


# =============================================================================
# RESPONSE MODELS
# =============================================================================

class SheetInfo(BaseModel):
    name: str
    rows: int
    columns: int
    column_names: list[str] = []


class UploadResponse(BaseModel):
    success: bool
    file_id: str
    filename: str
    sheets: list[SheetInfo]


class FormulaRequest(BaseModel):
    formula: str
    file_id: Optional[str] = None
    sheet_name: Optional[str] = None


class PythonQueryRequest(BaseModel):
    code: str
    file_id: Optional[str] = None


class FriendlyError(BaseModel):
    type: str = "friendly_error"
    icon: str
    message: str
    suggestions: list[str]


# =============================================================================
# UPLOAD - Conversation-aware context loading
# =============================================================================

@router.post("/upload", response_model=UploadResponse)
async def upload_spreadsheet(
    file: UploadFile = File(...),
    conversation_id: Optional[int] = Query(None, description="Auto-add to this conversation"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Upload a spreadsheet. File is stored in database for persistence.
    
    IMPORTANT: File is only loaded into memory if it belongs to the 
    currently active conversation (for context isolation).
    """
    filename = file.filename or "uploaded_file"
    
    if not any(filename.endswith(ext) for ext in [".xlsx", ".xls", ".csv", ".tsv"]):
        raise HTTPException(status_code=400, detail="Unsupported file type")
    
    try:
        contents = await file.read()
        
        if len(contents) > 50 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="File too large. Maximum 50MB.")
        
        file_buffer = io.BytesIO(contents)
        
        # Parse into DataFrames
        if filename.endswith(".csv"):
            df = pd.read_csv(file_buffer)
            sheets = {"Sheet1": df}
        elif filename.endswith(".tsv"):
            df = pd.read_csv(file_buffer, sep="\t")
            sheets = {"Sheet1": df}
        else:
            sheets = pd.read_excel(file_buffer, sheet_name=None)
        
        file_id = str(uuid.uuid4())
        
        # Build sheet summaries
        sheet_summaries = []
        for sheet_name, df in sheets.items():
            sheet_summaries.append(SheetInfo(
                name=sheet_name,
                rows=len(df),
                columns=len(df.columns),
                column_names=df.columns.tolist()
            ))
        
        # Check if this conversation is the currently active one
        current_active_conv = get_current_loaded_conversation(current_user.id)
        should_load_to_memory = (
            conversation_id is not None and 
            conversation_id == current_active_conv
        )
        
        # Only load to memory if this is the active conversation
        if should_load_to_memory:
            add_file_to_context(file_id, filename, contents, sheets)
        
        # Persist to database with raw bytes
        spreadsheet_record = Spreadsheet(
            user_id=current_user.id,
            file_id=file_id,
            filename=filename,
            file_data=contents,  # Store raw bytes!
            sheet_info={"sheets": [s.model_dump() for s in sheet_summaries]},
            file_size=len(contents)
        )
        db.add(spreadsheet_record)
        db.flush()
        
        # Auto-add to conversation if specified
        if conversation_id:
            conv = db.query(Conversation).filter(
                Conversation.id == conversation_id,
                Conversation.user_id == current_user.id
            ).first()
            
            if conv:
                cf = ConversationFile(
                    conversation_id=conv.id,
                    spreadsheet_id=spreadsheet_record.id
                )
                db.add(cf)
        
        db.commit()
        
        return UploadResponse(
            success=True,
            file_id=file_id,
            filename=filename,
            sheets=sheet_summaries
        )
    
    except pd.errors.EmptyDataError:
        raise HTTPException(status_code=400, detail="The file appears to be empty.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error parsing file: {str(e)}")


# =============================================================================
# FORMULA EXECUTION
# =============================================================================

@router.post("/execute/formula")
async def execute_formula_endpoint(
    request: FormulaRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Execute a formula on spreadsheet data."""
    file_id = request.file_id
    
    if not file_id:
        files = list_available_files()
        if len(files) == 1:
            file_id = files[0]["file_id"]
        elif len(files) == 0:
            return FriendlyError(
                icon="📁",
                message="No spreadsheet loaded. Please upload a file first.",
                suggestions=[]
            ).model_dump()
        else:
            return FriendlyError(
                icon="📑",
                message=f"You have {len(files)} files loaded. Which one?",
                suggestions=[f"Use {f['filename']}" for f in files[:3]]
            ).model_dump()
    
    # Verify ownership and ensure file is loaded
    ss = db.query(Spreadsheet).filter(
        Spreadsheet.file_id == file_id,
        Spreadsheet.user_id == current_user.id
    ).first()
    
    if not ss:
        raise HTTPException(status_code=404, detail="Spreadsheet not found")
    
    # Load from DB if not in memory
    if not is_file_loaded(file_id) and ss.file_data:
        restore_file_from_bytes(file_id, ss.filename, ss.file_data, ss.sheet_info)
    
    # Auto-detect sheet
    sheet_name = request.sheet_name
    if not sheet_name:
        if file_id in spreadsheet_context["files"]:
            sheets = spreadsheet_context["files"][file_id]["sheets"]
            if len(sheets) == 1:
                sheet_name = list(sheets.keys())[0]
            else:
                return FriendlyError(
                    icon="📑",
                    message=f"This file has multiple sheets. Which one?",
                    suggestions=[f"Use sheet '{s}'" for s in list(sheets.keys())[:4]]
                ).model_dump()
    
    try:
        result = execute_formula(request.formula, file_id, sheet_name)
        
        if isinstance(result, dict) and "error" in result:
            context = extract_context_for_errors(file_id)
            return friendly_error_response(Exception(result["error"]), context)
        
        return {
            "formula": request.formula,
            "result": result,
            "sheet": sheet_name
        }
    
    except Exception as e:
        context = extract_context_for_errors(file_id)
        return friendly_error_response(e, context)


# =============================================================================
# PYTHON EXECUTION
# =============================================================================

@router.post("/execute/python")
async def execute_python_endpoint(
    request: PythonQueryRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Execute Python/pandas code on spreadsheet data."""
    file_id = request.file_id
    
    if not file_id:
        files = list_available_files()
        if len(files) == 1:
            file_id = files[0]["file_id"]
        elif len(files) == 0:
            return FriendlyError(
                icon="📁",
                message="No spreadsheet loaded.",
                suggestions=[]
            ).model_dump()
        else:
            return FriendlyError(
                icon="📑",
                message=f"You have {len(files)} files loaded. Which one?",
                suggestions=[f"Use {f['filename']}" for f in files[:3]]
            ).model_dump()
    
    ss = db.query(Spreadsheet).filter(
        Spreadsheet.file_id == file_id,
        Spreadsheet.user_id == current_user.id
    ).first()
    
    if not ss:
        raise HTTPException(status_code=404, detail="Spreadsheet not found")
    
    # Load from DB if not in memory
    if not is_file_loaded(file_id) and ss.file_data:
        restore_file_from_bytes(file_id, ss.filename, ss.file_data, ss.sheet_info)
    
    try:
        result = execute_python_query(request.code, file_id)
        
        if isinstance(result, dict) and "error" in result:
            context = extract_context_for_errors(file_id)
            return friendly_error_response(Exception(result["error"]), context)
        
        return {
            "code": request.code,
            "result": result
        }
    
    except Exception as e:
        context = extract_context_for_errors(file_id)
        return friendly_error_response(e, context)


# =============================================================================
# STRUCTURE ENDPOINT
# =============================================================================

@router.get("/spreadsheet/{file_id}/structure")
async def get_spreadsheet_structure(
    file_id: str,
    include_cells: bool = False,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get the structure of a spreadsheet."""
    ss = db.query(Spreadsheet).filter(
        Spreadsheet.file_id == file_id,
        Spreadsheet.user_id == current_user.id
    ).first()
    
    if not ss:
        raise HTTPException(status_code=404, detail="Spreadsheet not found")
    
    # Load from DB if not in memory
    if not is_file_loaded(file_id):
        if ss.file_data:
            restore_file_from_bytes(file_id, ss.filename, ss.file_data, ss.sheet_info)
        else:
            return {
                "file_id": file_id,
                "in_memory": False,
                "message": "File data not available. Please re-upload."
            }
    
    if file_id not in spreadsheet_context["structures"]:
        return {
            "file_id": file_id,
            "in_memory": False,
            "message": "Structure not available."
        }
    
    structures = spreadsheet_context["structures"][file_id]
    
    result = {
        "file_id": file_id,
        "filename": ss.filename,
        "structures": {}
    }
    
    for name, s in structures.items():
        if isinstance(s.row_labels, dict):
            row_labels = dict(list(s.row_labels.items())[:25])
        else:
            row_labels = s.row_labels[:25] if s.row_labels else []
        
        if isinstance(s.headers, dict):
            headers = s.headers
        else:
            headers = s.headers if s.headers else []
        
        sheet_data = {
            "rows": s.rows,
            "cols": s.cols,
            "headers": headers,
            "row_labels": row_labels,
            "formulas": dict(list(s.formulas.items())[:20]) if s.formulas else {},
            "cell_type_counts": _count_types(s.cell_types) if s.cell_types else {}
        }
        
        if include_cells:
            if hasattr(s, 'text_values') and s.text_values:
                sheet_data["text_values"] = s.text_values
            
            if file_id in spreadsheet_context["files"]:
                file_data = spreadsheet_context["files"][file_id]
                if name in file_data["sheets"]:
                    df = file_data["sheets"][name]
                    numeric_values = {}
                    max_rows = min(len(df), 100)
                    max_cols = min(len(df.columns), 26)
                    
                    for row_idx in range(max_rows):
                        for col_idx in range(max_cols):
                            col_letter = _get_column_letter(col_idx)
                            cell_addr = f"{col_letter}{row_idx + 2}"
                            value = df.iloc[row_idx, col_idx]
                            
                            if pd.notna(value) and isinstance(value, (int, float)):
                                if hasattr(value, 'item'):
                                    numeric_values[cell_addr] = value.item()
                                else:
                                    numeric_values[cell_addr] = float(value) if isinstance(value, float) else int(value)
                    
                    if numeric_values:
                        sheet_data["numeric_values"] = numeric_values
        
        if include_cells and hasattr(s, 'cell_types') and s.cell_types:
            sheet_data["cell_types"] = s.cell_types
        
        result["structures"][name] = sheet_data
    
    return result


def _get_column_letter(idx: int) -> str:
    result = ""
    idx += 1
    while idx > 0:
        idx -= 1
        result = chr(65 + idx % 26) + result
        idx //= 26
    return result


def _count_types(cell_types: dict) -> dict:
    counts = {}
    for t in cell_types.values():
        counts[t] = counts.get(t, 0) + 1
    return counts


# =============================================================================
# LIST / DELETE ENDPOINTS
# =============================================================================

@router.get("/spreadsheet")
async def get_spreadsheet_info(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all spreadsheets for the current user."""
    user_spreadsheets = db.query(Spreadsheet).filter(
        Spreadsheet.user_id == current_user.id
    ).order_by(Spreadsheet.created_at.desc()).all()
    
    if not user_spreadsheets:
        return {"loaded": False, "files": []}
    
    files = []
    for ss in user_spreadsheets:
        sheet_info = ss.sheet_info or {}
        
        file_info = {
            "id": ss.file_id,
            "filename": ss.filename,
            "in_memory": is_file_loaded(ss.file_id),
            "has_data": ss.file_data is not None,
            "file_size": ss.file_size,
            "created_at": ss.created_at.isoformat() if ss.created_at else None,
        }
        
        if is_file_loaded(ss.file_id):
            file_data = spreadsheet_context["files"][ss.file_id]
            file_info["sheets"] = [
                {
                    "name": name,
                    "rows": len(df),
                    "columns": len(df.columns),
                    "column_names": df.columns.tolist(),
                }
                for name, df in file_data["sheets"].items()
            ]
        else:
            file_info["sheets"] = sheet_info.get("sheets", [])
        
        files.append(file_info)
    
    return {"loaded": True, "files": files}


@router.delete("/spreadsheet/{file_id}")
async def delete_spreadsheet(
    file_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a spreadsheet."""
    ss = db.query(Spreadsheet).filter(
        Spreadsheet.file_id == file_id,
        Spreadsheet.user_id == current_user.id
    ).first()
    
    if not ss:
        raise HTTPException(status_code=404, detail="Spreadsheet not found")
    
    remove_file_from_context(file_id)
    db.delete(ss)
    db.commit()
    
    return {"success": True}


@router.delete("/spreadsheet")
async def clear_all_spreadsheets(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete all spreadsheets for the current user."""
    user_spreadsheets = db.query(Spreadsheet).filter(
        Spreadsheet.user_id == current_user.id
    ).all()
    
    for ss in user_spreadsheets:
        remove_file_from_context(ss.file_id)
        db.delete(ss)
    
    db.commit()
    return {"success": True}


# =============================================================================
# RESTORE FILE ENDPOINT
# =============================================================================

@router.post("/spreadsheet/{file_id}/restore")
async def restore_spreadsheet(
    file_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Restore a file from database to memory."""
    ss = db.query(Spreadsheet).filter(
        Spreadsheet.file_id == file_id,
        Spreadsheet.user_id == current_user.id
    ).first()
    
    if not ss:
        raise HTTPException(status_code=404, detail="Spreadsheet not found")
    
    if is_file_loaded(file_id):
        return {"status": "already_loaded", "file_id": file_id}
    
    if not ss.file_data:
        raise HTTPException(status_code=400, detail="No file data stored")
    
    try:
        restore_file_from_bytes(file_id, ss.filename, ss.file_data, ss.sheet_info)
        return {"status": "restored", "file_id": file_id, "filename": ss.filename}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to restore: {str(e)}")