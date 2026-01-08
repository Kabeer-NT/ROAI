"""
Spreadsheet Routes (Protected)
"""

from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from sqlalchemy.orm import Session
import pandas as pd
import io
import uuid
import json

from app.services.db import get_db
from app.services.auth import get_current_user
from app.services.spreadsheet import (
    spreadsheet_context,
    clear_context,
    add_file_to_context,
    remove_file_from_context,
)
from app.models import User, Spreadsheet

router = APIRouter(tags=["spreadsheet"])


@router.post("/upload")
async def upload_spreadsheet(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    filename = file.filename or "uploaded_file"
    
    if not any(filename.endswith(ext) for ext in [".xlsx", ".xls", ".csv", ".tsv"]):
        raise HTTPException(status_code=400, detail="Unsupported file type")
    
    try:
        contents = await file.read()
        file_buffer = io.BytesIO(contents)
        
        if filename.endswith(".csv"):
            df = pd.read_csv(file_buffer)
            sheets = {"Sheet1": df}
        elif filename.endswith(".tsv"):
            df = pd.read_csv(file_buffer, sep="\t")
            sheets = {"Sheet1": df}
        else:
            sheets = pd.read_excel(file_buffer, sheet_name=None)
        
        file_id = str(uuid.uuid4())
        
        sheet_summaries = [
            {
                "name": sheet_name,
                "rows": len(df),
                "columns": len(df.columns),
                "column_names": df.columns.tolist(),
            }
            for sheet_name, df in sheets.items()
        ]
        
        add_file_to_context(file_id, filename, sheets)
        
        spreadsheet_record = Spreadsheet(
            user_id=current_user.id,
            file_id=file_id,
            filename=filename,
            sheet_info=json.dumps(sheet_summaries)
        )
        db.add(spreadsheet_record)
        db.commit()
        
        return {
            "success": True,
            "file_id": file_id,
            "filename": filename,
            "sheets": sheet_summaries,
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error parsing file: {str(e)}")


@router.get("/spreadsheet")
async def get_spreadsheet_info(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    user_spreadsheets = db.query(Spreadsheet).filter(
        Spreadsheet.user_id == current_user.id
    ).all()
    
    if not user_spreadsheets:
        return {"loaded": False, "files": []}
    
    files = []
    for ss in user_spreadsheets:
        if ss.file_id in spreadsheet_context["files"]:
            file_data = spreadsheet_context["files"][ss.file_id]
            files.append({
                "id": ss.file_id,
                "filename": ss.filename,
                "sheets": [
                    {
                        "name": name,
                        "rows": len(df),
                        "columns": len(df.columns),
                        "column_names": df.columns.tolist(),
                    }
                    for name, df in file_data["sheets"].items()
                ],
            })
        else:
            files.append({
                "id": ss.file_id,
                "filename": ss.filename,
                "sheets": json.loads(ss.sheet_info),
                "needs_reupload": True
            })
    
    return {"loaded": True, "files": files}


@router.delete("/spreadsheet/{file_id}")
async def delete_spreadsheet(
    file_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
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
    user_spreadsheets = db.query(Spreadsheet).filter(
        Spreadsheet.user_id == current_user.id
    ).all()
    
    for ss in user_spreadsheets:
        remove_file_from_context(ss.file_id)
        db.delete(ss)
    
    db.commit()
    return {"success": True}
