"""
Spreadsheet Routes (Protected)
==============================
Uploads store raw bytes for formula execution.
LLM only sees structure, never numeric values.
"""

from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
import pandas as pd
import io
import uuid
import json
import re

from app.services.db import get_db
from app.services.auth import get_current_user
from app.services.spreadsheet import (
    spreadsheet_context,
    add_file_to_context,
    remove_file_from_context,
    execute_formula,
    execute_python_query,
    get_file_id_by_name,
    list_available_files,
    build_llm_context,
)
from app.models import User, Spreadsheet

router = APIRouter(tags=["spreadsheet"])


class UploadResponse(BaseModel):
    success: bool
    file_id: str
    filename: str
    sheets: list[dict]


class FormulaRequest(BaseModel):
    formula: str
    file_id: Optional[str] = None
    sheet_name: Optional[str] = None


class PythonQueryRequest(BaseModel):
    code: str
    file_id: Optional[str] = None


@router.post("/upload", response_model=UploadResponse)
async def upload_spreadsheet(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Upload a spreadsheet. Raw data is stored for execution,
    but LLM only sees structure (headers, labels, formulas).
    """
    filename = file.filename or "uploaded_file"
    
    if not any(filename.endswith(ext) for ext in [".xlsx", ".xls", ".csv", ".tsv"]):
        raise HTTPException(status_code=400, detail="Unsupported file type")
    
    try:
        # Read raw bytes
        contents = await file.read()
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
            summary = {
                "name": sheet_name,
                "rows": len(df),
                "columns": len(df.columns),
                "column_names": df.columns.tolist(),
            }
            sheet_summaries.append(summary)
        
        # Store with raw bytes for execution
        add_file_to_context(file_id, filename, contents, sheets)
        
        # Persist metadata to database
        spreadsheet_record = Spreadsheet(
            user_id=current_user.id,
            file_id=file_id,
            filename=filename,
            sheet_info=json.dumps({"sheets": sheet_summaries})
        )
        db.add(spreadsheet_record)
        db.commit()
        
        return UploadResponse(
            success=True,
            file_id=file_id,
            filename=filename,
            sheets=sheet_summaries
        )
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error parsing file: {str(e)}")


@router.post("/execute/formula")
async def execute_formula_endpoint(
    request: FormulaRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Execute a formula on spreadsheet data.
    Used by Claude to compute results without seeing raw values.
    """
    file_id = request.file_id
    
    # Auto-detect file if not specified
    if not file_id:
        files = list_available_files()
        if len(files) == 1:
            file_id = files[0]["file_id"]
        else:
            raise HTTPException(
                status_code=400, 
                detail="Multiple files loaded. Please specify file_id."
            )
    
    # Verify ownership
    ss = db.query(Spreadsheet).filter(
        Spreadsheet.file_id == file_id,
        Spreadsheet.user_id == current_user.id
    ).first()
    
    if not ss:
        raise HTTPException(status_code=404, detail="Spreadsheet not found")
    
    # Auto-detect sheet if not specified
    sheet_name = request.sheet_name
    if not sheet_name:
        if file_id in spreadsheet_context["files"]:
            sheets = spreadsheet_context["files"][file_id]["sheets"]
            if len(sheets) == 1:
                sheet_name = list(sheets.keys())[0]
            else:
                raise HTTPException(
                    status_code=400,
                    detail=f"Multiple sheets available: {list(sheets.keys())}. Please specify sheet_name."
                )
    
    result = execute_formula(request.formula, file_id, sheet_name)
    
    if isinstance(result, dict) and "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    
    return {
        "formula": request.formula,
        "result": result,
        "sheet": sheet_name
    }


@router.post("/execute/python")
async def execute_python_endpoint(
    request: PythonQueryRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Execute Python/pandas code on spreadsheet data.
    More flexible than formulas for complex queries.
    """
    file_id = request.file_id
    
    if not file_id:
        files = list_available_files()
        if len(files) == 1:
            file_id = files[0]["file_id"]
        else:
            raise HTTPException(
                status_code=400,
                detail="Multiple files loaded. Please specify file_id."
            )
    
    # Verify ownership
    ss = db.query(Spreadsheet).filter(
        Spreadsheet.file_id == file_id,
        Spreadsheet.user_id == current_user.id
    ).first()
    
    if not ss:
        raise HTTPException(status_code=404, detail="Spreadsheet not found")
    
    result = execute_python_query(request.code, file_id)
    
    if isinstance(result, dict) and "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    
    return {
        "code": request.code,
        "result": result
    }


@router.get("/spreadsheet/{file_id}/structure")
async def get_spreadsheet_structure(
    file_id: str,
    include_cells: bool = False,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get the structure of a spreadsheet (what the LLM sees).
    When include_cells=True, also returns numeric_values for the UI preview.
    """
    ss = db.query(Spreadsheet).filter(
        Spreadsheet.file_id == file_id,
        Spreadsheet.user_id == current_user.id
    ).first()
    
    if not ss:
        raise HTTPException(status_code=404, detail="Spreadsheet not found")
    
    if file_id not in spreadsheet_context["structures"]:
        return {
            "file_id": file_id,
            "in_memory": False,
            "message": "Spreadsheet not in memory. Please re-upload."
        }
    
    structures = spreadsheet_context["structures"][file_id]
    
    result = {
        "file_id": file_id,
        "filename": ss.filename,
        "structures": {}
    }
    
    for name, s in structures.items():
        # Handle both dict and list formats for backwards compatibility
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
        
        # Include text_values for grid view if requested
        if include_cells:
            if hasattr(s, 'text_values') and s.text_values:
                sheet_data["text_values"] = s.text_values
            
            # NEW: Include numeric values for UI preview (whitelisting feature)
            # Pull from actual DataFrame data
            if file_id in spreadsheet_context["files"]:
                file_data = spreadsheet_context["files"][file_id]
                if name in file_data["sheets"]:
                    df = file_data["sheets"][name]
                    numeric_values = {}
                    max_rows = min(len(df), 100)  # Limit to 100 rows
                    max_cols = min(len(df.columns), 26)  # Limit to 26 columns (A-Z)
                    
                    for row_idx in range(max_rows):
                        for col_idx in range(max_cols):
                            col_letter = _get_column_letter(col_idx)
                            cell_addr = f"{col_letter}{row_idx + 2}"  # +2 because row 1 is header
                            value = df.iloc[row_idx, col_idx]
                            
                            # Only include numeric values
                            if pd.notna(value) and isinstance(value, (int, float)):
                                # Convert numpy types to Python native
                                if hasattr(value, 'item'):  # numpy scalar
                                    numeric_values[cell_addr] = value.item()
                                else:
                                    numeric_values[cell_addr] = float(value) if isinstance(value, float) else int(value)
                    
                    if numeric_values:
                        sheet_data["numeric_values"] = numeric_values
        
        # Include full cell types for grid view if requested
        if include_cells and hasattr(s, 'cell_types') and s.cell_types:
            sheet_data["cell_types"] = s.cell_types
        
        result["structures"][name] = sheet_data
    
    return result


def _get_column_letter(idx: int) -> str:
    """Convert 0-indexed column number to Excel-style letter (A, B, ..., Z, AA, etc.)"""
    result = ""
    idx += 1  # Convert to 1-indexed
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


@router.get("/spreadsheet")
async def get_spreadsheet_info(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all spreadsheets for the current user."""
    user_spreadsheets = db.query(Spreadsheet).filter(
        Spreadsheet.user_id == current_user.id
    ).all()
    
    if not user_spreadsheets:
        return {"loaded": False, "files": []}
    
    files = []
    for ss in user_spreadsheets:
        sheet_info = json.loads(ss.sheet_info)
        
        file_info = {
            "id": ss.file_id,
            "filename": ss.filename,
            "in_memory": ss.file_id in spreadsheet_context["files"],
        }
        
        if ss.file_id in spreadsheet_context["files"]:
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
            file_info["needs_reupload"] = True
        
        files.append(file_info)
    
    return {"loaded": True, "files": files}


@router.delete("/spreadsheet/{file_id}")
async def delete_spreadsheet(
    file_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a specific spreadsheet."""
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