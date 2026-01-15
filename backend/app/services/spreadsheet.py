"""
Spreadsheet Service - FLEXIBLE Visibility Support with EXECUTION BLOCKING
==========================================================================
Supports BOTH visibility key formats:
- Keyed by file_id (UUID): "3d2ae260-09c1-40fa-ba81-3ba9b6be45a3"
- Keyed by filename: "ROAI_Test_Data.xlsx"

And BOTH visibility structures:
- Flat: { hiddenColumns: [], hiddenRows: [], hiddenCells: [] }
- Sheet-scoped: { "Sheet1": { hiddenColumns: [], ... } }

CRITICAL: Visibility is ENFORCED during execution, not just in context building.
Hidden rows/columns/cells will be SKIPPED.

ENHANCED: Now includes instant insights, quick actions, and friendly errors.
"""

import pandas as pd
import openpyxl
from openpyxl.utils import get_column_letter, column_index_from_string
import re
import json
from typing import Optional, Any
from dataclasses import dataclass
from io import BytesIO
from datetime import datetime


@dataclass
class SheetStructure:
    """Structural representation of a sheet - NO numeric values"""
    name: str
    rows: int
    cols: int
    headers: dict[str, str]
    row_labels: dict[str, str]
    text_values: dict[str, str]
    formulas: dict[str, str]
    cell_types: dict[str, str]


# Global storage
spreadsheet_context: dict = {
    "files": {},           # file_id -> {filename, sheets: {name -> DataFrame}}
    "structures": {},      # file_id -> {sheet_name -> SheetStructure}
    "raw_bytes": {},       # file_id -> original file bytes
    "current_visibility": None,  # Store current visibility for execution
}


# =============================================================================
# VISIBILITY HELPERS - FLEXIBLE FORMAT SUPPORT
# =============================================================================

def set_current_visibility(visibility: dict = None):
    """Store visibility settings for use during execution."""
    spreadsheet_context["current_visibility"] = visibility


def get_current_visibility() -> dict:
    """Get current visibility settings."""
    return spreadsheet_context.get("current_visibility")


def get_filename_for_file_id(file_id: str) -> Optional[str]:
    """Get filename for a given file_id."""
    if file_id in spreadsheet_context["files"]:
        return spreadsheet_context["files"][file_id].get("filename")
    return None


def get_file_id_for_filename(filename: str) -> Optional[str]:
    """Get file_id for a given filename."""
    for fid, data in spreadsheet_context["files"].items():
        if data.get("filename") == filename:
            return fid
    return None


def _get_visibility_for_file(file_id: str, filename: str, visibility: dict) -> dict:
    """
    Get visibility settings for a file, checking both file_id and filename keys.
    Returns the flat visibility dict or None.
    """
    if not visibility:
        return None
    
    # Try file_id first (what frontend currently sends)
    if file_id and file_id in visibility:
        return visibility[file_id]
    
    # Try filename
    if filename and filename in visibility:
        return visibility[filename]
    
    return None


def _get_sheet_visibility(file_id: str, filename: str, sheet_name: str, visibility: dict) -> dict:
    """
    Get visibility for a specific sheet, handling both flat and sheet-scoped formats.
    
    Flat format: { hiddenColumns: [], hiddenRows: [], hiddenCells: [] }
    Sheet-scoped: { "Sheet1": { hiddenColumns: [], ... } }
    
    Returns dict with hiddenColumns, hiddenRows, hiddenCells or None.
    """
    file_vis = _get_visibility_for_file(file_id, filename, visibility)
    if not file_vis:
        return None
    
    # Check if it's sheet-scoped (has sheet name as key with nested structure)
    if sheet_name and sheet_name in file_vis:
        sheet_vis = file_vis[sheet_name]
        # Verify it's actually a visibility structure
        if isinstance(sheet_vis, dict) and ('hiddenRows' in sheet_vis or 'hiddenColumns' in sheet_vis or 'hiddenCells' in sheet_vis):
            return sheet_vis
    
    # Check if it's flat format (has hiddenRows directly)
    if 'hiddenRows' in file_vis or 'hiddenColumns' in file_vis or 'hiddenCells' in file_vis:
        return file_vis
    
    return None


def is_cell_hidden(
    file_id: str,
    filename: str, 
    sheet_name: str,
    cell_addr: str, 
    visibility: dict = None
) -> bool:
    """
    Check if a cell should be hidden based on visibility settings.
    Handles both flat and sheet-scoped formats.
    """
    sheet_vis = _get_sheet_visibility(file_id, filename, sheet_name, visibility)
    if not sheet_vis:
        return False
    
    cell_addr_upper = cell_addr.upper()
    
    # Check individual cell
    hidden_cells = sheet_vis.get('hiddenCells', [])
    if cell_addr_upper in [c.upper() for c in hidden_cells]:
        return True
    
    # Extract column and row from cell address
    match = re.match(r'^([A-Z]+)(\d+)$', cell_addr_upper)
    if not match:
        return False
    
    col, row_str = match.groups()
    row = int(row_str)
    
    # Check column
    hidden_cols = sheet_vis.get('hiddenColumns', [])
    if col in [c.upper() for c in hidden_cols]:
        return True
    
    # Check row
    hidden_rows = sheet_vis.get('hiddenRows', [])
    if row in hidden_rows:
        return True
    
    return False


def is_row_hidden(file_id: str, filename: str, sheet_name: str, row: int, visibility: dict = None) -> bool:
    """Check if an entire row is hidden."""
    sheet_vis = _get_sheet_visibility(file_id, filename, sheet_name, visibility)
    if not sheet_vis:
        return False
    
    return row in sheet_vis.get('hiddenRows', [])


def is_column_hidden(file_id: str, filename: str, sheet_name: str, col: str, visibility: dict = None) -> bool:
    """Check if an entire column is hidden."""
    sheet_vis = _get_sheet_visibility(file_id, filename, sheet_name, visibility)
    if not sheet_vis:
        return False
    
    hidden_cols = sheet_vis.get('hiddenColumns', [])
    return col.upper() in [c.upper() for c in hidden_cols]


def get_visibility_summary(file_id: str, filename: str, sheet_name: str, visibility: dict = None) -> str:
    """Get a human-readable summary of what's hidden."""
    sheet_vis = _get_sheet_visibility(file_id, filename, sheet_name, visibility)
    if not sheet_vis:
        return ""
    
    parts = []
    
    cols = sheet_vis.get('hiddenColumns', [])
    rows = sheet_vis.get('hiddenRows', [])
    cells = sheet_vis.get('hiddenCells', [])
    
    if cols:
        parts.append(f"Columns {', '.join(sorted(cols))}")
    if rows:
        sorted_rows = sorted(rows)
        if len(sorted_rows) > 10:
            parts.append(f"Rows {sorted_rows[0]}-{sorted_rows[-1]} ({len(sorted_rows)} rows)")
        else:
            parts.append(f"Rows {', '.join(map(str, sorted_rows))}")
    if cells:
        parts.append(f"Cells {', '.join(sorted(cells))}")
    
    if parts:
        return f"[HIDDEN FROM AI: {'; '.join(parts)}]"
    return ""


# =============================================================================
# FILE MANAGEMENT
# =============================================================================

def clear_context():
    spreadsheet_context["files"] = {}
    spreadsheet_context["structures"] = {}
    spreadsheet_context["raw_bytes"] = {}
    spreadsheet_context["current_visibility"] = None


def extract_structure_from_excel(file_bytes: bytes) -> dict[str, SheetStructure]:
    """Extract structure from Excel file including formulas."""
    structures = {}
    
    try:
        wb = openpyxl.load_workbook(BytesIO(file_bytes), data_only=False)
        wb_values = openpyxl.load_workbook(BytesIO(file_bytes), data_only=True)
        
        for sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
            ws_values = wb_values[sheet_name]
            
            formulas = {}
            cell_types = {}
            headers = {}
            row_labels = {}
            text_values = {}
            
            max_row = ws.max_row or 1
            max_col = ws.max_column or 1
            
            # Find header row
            header_row = None
            max_header_score = 0
            
            for row_idx in range(1, min(max_row + 1, 15)):
                text_count = 0
                for col_idx in range(1, max_col + 1):
                    value = ws_values.cell(row=row_idx, column=col_idx).value
                    if value is not None and value != "":
                        if isinstance(value, str) and not value.startswith("⚠") and not value.startswith("🔍"):
                            text_count += 1
                
                if text_count >= 3 and text_count > max_header_score:
                    max_header_score = text_count
                    header_row = row_idx
            
            # Extract structure
            for row_idx in range(1, max_row + 1):
                for col_idx in range(1, max_col + 1):
                    cell = ws.cell(row=row_idx, column=col_idx)
                    cell_addr = f"{get_column_letter(col_idx)}{row_idx}"
                    value_cell = ws_values.cell(row=row_idx, column=col_idx)
                    value = value_cell.value
                    
                    if cell.value and isinstance(cell.value, str) and cell.value.startswith("="):
                        formulas[cell_addr] = cell.value
                        cell_types[cell_addr] = "formula"
                    elif value is None or value == "":
                        cell_types[cell_addr] = "empty"
                    elif isinstance(value, (int, float)):
                        cell_types[cell_addr] = "numeric"
                    else:
                        cell_types[cell_addr] = "text"
                        text_values[cell_addr] = str(value)[:100]
                    
                    if row_idx == header_row and value is not None and isinstance(value, str):
                        headers[cell_addr] = str(value)
                    
                    if col_idx == 1 and header_row and row_idx > header_row:
                        if value is not None and isinstance(value, str) and not value.startswith("⚠") and not value.startswith("🔍") and not value.startswith("•"):
                            row_labels[cell_addr] = str(value)
            
            structures[sheet_name] = SheetStructure(
                name=sheet_name,
                rows=max_row,
                cols=max_col,
                headers=headers,
                row_labels=row_labels,
                text_values=text_values,
                formulas=formulas,
                cell_types=cell_types,
            )
        
        wb.close()
        wb_values.close()
        
    except Exception as e:
        print(f"Error extracting structure: {e}")
        
    return structures


def extract_structure_from_csv(df: pd.DataFrame, sheet_name: str) -> SheetStructure:
    """Extract structure from CSV/TSV DataFrame."""
    cell_types = {}
    headers = {}
    row_labels = {}
    text_values = {}
    
    for col_idx, col_name in enumerate(df.columns):
        col_letter = get_column_letter(col_idx + 1)
        cell_addr = f"{col_letter}1"
        cell_types[cell_addr] = "text"
        headers[cell_addr] = str(col_name)
        text_values[cell_addr] = str(col_name)
        
        for row_idx, value in enumerate(df[col_name], start=2):
            cell_addr = f"{col_letter}{row_idx}"
            
            if pd.isna(value):
                cell_types[cell_addr] = "empty"
            elif isinstance(value, (int, float)):
                cell_types[cell_addr] = "numeric"
            else:
                cell_types[cell_addr] = "text"
                text_values[cell_addr] = str(value)[:100]
                if col_idx == 0:
                    row_labels[cell_addr] = str(value)[:50]
    
    return SheetStructure(
        name=sheet_name,
        rows=len(df) + 1,
        cols=len(df.columns),
        headers=headers,
        row_labels=row_labels,
        text_values=text_values,
        formulas={},
        cell_types=cell_types,
    )


def add_file_to_context(file_id: str, filename: str, file_bytes: bytes, sheets: dict[str, pd.DataFrame]):
    """Add file to context."""
    spreadsheet_context["files"][file_id] = {
        "filename": filename,
        "sheets": sheets
    }
    spreadsheet_context["raw_bytes"][file_id] = file_bytes
    
    if filename.endswith(('.xlsx', '.xls')):
        structures = extract_structure_from_excel(file_bytes)
    else:
        structures = {}
        for sheet_name, df in sheets.items():
            structures[sheet_name] = extract_structure_from_csv(df, sheet_name)
    
    spreadsheet_context["structures"][file_id] = structures


def remove_file_from_context(file_id: str):
    for store in ["files", "structures", "raw_bytes"]:
        if file_id in spreadsheet_context[store]:
            del spreadsheet_context[store][file_id]


# =============================================================================
# LLM CONTEXT BUILDING
# =============================================================================

def build_llm_context(visibility: dict = None) -> str:
    """
    Build context for LLM showing ONLY structure - NO numeric values.
    Respects visibility settings to hide user-specified data.
    Also stores visibility for use during execution.
    """
    # Store visibility for use during execution
    set_current_visibility(visibility)
    
    if not spreadsheet_context["structures"]:
        return ""
    
    parts = ["# SPREADSHEET STRUCTURE (numeric values hidden)\n"]
    parts.append("Reference cells directly by address (e.g., C5, D4:D9). I will execute formulas and return results.\n")
    
    for file_id, file_data in spreadsheet_context["files"].items():
        filename = file_data["filename"]
        structures = spreadsheet_context["structures"].get(file_id, {})
        
        parts.append(f"## File: {filename}")
        
        for sheet_name, structure in structures.items():
            parts.append(f"\n### Sheet: {sheet_name}")
            parts.append(f"Size: {structure.rows} rows × {structure.cols} columns")
            
            # Add visibility summary
            vis_summary = get_visibility_summary(file_id, filename, sheet_name, visibility)
            if vis_summary:
                parts.append(f"{vis_summary}")
            
            parts.append("")
            
            # Show headers (skip hidden ones)
            if structure.headers:
                visible_headers = {
                    addr: text for addr, text in structure.headers.items()
                    if not is_cell_hidden(file_id, filename, sheet_name, addr, visibility)
                }
                if visible_headers:
                    parts.append("**Column Headers:**")
                    for cell_addr, header_text in sorted(visible_headers.items(), 
                            key=lambda x: column_index_from_string(x[0].rstrip('0123456789'))):
                        parts.append(f"  {cell_addr}: {header_text}")
            
            # Show row labels (skip hidden ones)
            if structure.row_labels:
                visible_labels = {
                    addr: text for addr, text in structure.row_labels.items()
                    if not is_cell_hidden(file_id, filename, sheet_name, addr, visibility)
                }
                if visible_labels:
                    parts.append(f"\n**Row Labels (column A):**")
                    items = list(visible_labels.items())[:25]
                    for cell_addr, label in items:
                        parts.append(f"  {cell_addr}: {label}")
                    if len(visible_labels) > 25:
                        parts.append(f"  ... and {len(visible_labels) - 25} more rows")
            
            # Show data range
            if structure.headers:
                header_cells = list(structure.headers.keys())
                if header_cells:
                    header_row = int(re.search(r'\d+', header_cells[0]).group())
                    data_start_row = header_row + 1
                    last_data_row = structure.rows
                    parts.append(f"\n**Data Range:** Row {data_start_row} to ~Row {last_data_row}")
            
            # Show formulas (skip hidden ones)
            if structure.formulas:
                visible_formulas = {
                    addr: formula for addr, formula in structure.formulas.items()
                    if not is_cell_hidden(file_id, filename, sheet_name, addr, visibility)
                }
                if visible_formulas:
                    parts.append(f"\n**Existing Formulas:**")
                    for cell_addr, formula in list(visible_formulas.items())[:15]:
                        parts.append(f"  {cell_addr}: {formula}")
                    if len(visible_formulas) > 15:
                        parts.append(f"  ... and {len(visible_formulas) - 15} more formulas")
            
            # Show cell type summary
            type_counts = {}
            for cell_type in structure.cell_types.values():
                type_counts[cell_type] = type_counts.get(cell_type, 0) + 1
            parts.append(f"\n**Cell Types:** {json.dumps(type_counts)}")
        
        parts.append("")
    
    return "\n".join(parts)


# =============================================================================
# EXECUTION HELPERS - WITH VISIBILITY ENFORCEMENT
# =============================================================================

def _get_cell_value_with_visibility(ws, cell_ref: str, file_id: str, filename: str, sheet_name: str) -> Any:
    """Get value from a cell reference, respecting visibility."""
    match = re.match(r'^([A-Z]+)(\d+)$', cell_ref.upper())
    if not match:
        raise ValueError(f"Invalid cell reference: {cell_ref}")
    
    # Check visibility
    visibility = get_current_visibility()
    if visibility and is_cell_hidden(file_id, filename, sheet_name, cell_ref.upper(), visibility):
        return "[HIDDEN]"
    
    return ws[cell_ref].value


def _get_range_values_with_visibility(ws, range_ref: str, file_id: str, filename: str, sheet_name: str) -> list:
    """Get NUMERIC values from a range, respecting visibility. Hidden cells are skipped."""
    match = re.match(r'^([A-Z]+)(\d+):([A-Z]+)(\d+)$', range_ref.upper())
    if not match:
        raise ValueError(f"Invalid range reference: {range_ref}")
    
    col_start, row_start, col_end, row_end = match.groups()
    row_start, row_end = int(row_start), int(row_end)
    col_start_idx = column_index_from_string(col_start)
    col_end_idx = column_index_from_string(col_end)
    
    visibility = get_current_visibility()
    
    values = []
    for row in range(row_start, row_end + 1):
        # Skip entire hidden row
        if visibility and is_row_hidden(file_id, filename, sheet_name, row, visibility):
            continue
        
        for col in range(col_start_idx, col_end_idx + 1):
            col_letter = get_column_letter(col)
            cell_addr = f"{col_letter}{row}"
            
            # Skip hidden column
            if visibility and is_column_hidden(file_id, filename, sheet_name, col_letter, visibility):
                continue
            
            # Skip hidden cell
            if visibility and is_cell_hidden(file_id, filename, sheet_name, cell_addr, visibility):
                continue
            
            cell = ws.cell(row=row, column=col)
            if cell.value is not None and isinstance(cell.value, (int, float)):
                values.append(cell.value)
    
    return values


def _get_range_all_values_with_visibility(ws, range_ref: str, file_id: str, filename: str, sheet_name: str) -> list:
    """Get ALL values from a range, respecting visibility. Hidden cells are skipped."""
    match = re.match(r'^([A-Z]+)(\d+):([A-Z]+)(\d+)$', range_ref.upper())
    if not match:
        raise ValueError(f"Invalid range reference: {range_ref}")
    
    col_start, row_start, col_end, row_end = match.groups()
    row_start, row_end = int(row_start), int(row_end)
    col_start_idx = column_index_from_string(col_start)
    col_end_idx = column_index_from_string(col_end)
    
    visibility = get_current_visibility()
    
    values = []
    for row in range(row_start, row_end + 1):
        # Skip entire hidden row
        if visibility and is_row_hidden(file_id, filename, sheet_name, row, visibility):
            continue
        
        for col in range(col_start_idx, col_end_idx + 1):
            col_letter = get_column_letter(col)
            cell_addr = f"{col_letter}{row}"
            
            # Skip hidden column
            if visibility and is_column_hidden(file_id, filename, sheet_name, col_letter, visibility):
                continue
            
            # Skip hidden cell
            if visibility and is_cell_hidden(file_id, filename, sheet_name, cell_addr, visibility):
                continue
            
            cell = ws.cell(row=row, column=col)
            values.append(cell.value)
    
    return values


# Legacy functions without visibility (for backward compatibility)
def _get_cell_value(ws, cell_ref: str) -> Any:
    """Get value from a cell reference (legacy, no visibility check)."""
    match = re.match(r'^([A-Z]+)(\d+)$', cell_ref.upper())
    if not match:
        raise ValueError(f"Invalid cell reference: {cell_ref}")
    return ws[cell_ref].value


def _get_range_values(ws, range_ref: str) -> list:
    """Get NUMERIC values from a range (legacy, no visibility check)."""
    match = re.match(r'^([A-Z]+)(\d+):([A-Z]+)(\d+)$', range_ref.upper())
    if not match:
        raise ValueError(f"Invalid range reference: {range_ref}")
    
    col_start, row_start, col_end, row_end = match.groups()
    row_start, row_end = int(row_start), int(row_end)
    col_start_idx = column_index_from_string(col_start)
    col_end_idx = column_index_from_string(col_end)
    
    values = []
    for row in range(row_start, row_end + 1):
        for col in range(col_start_idx, col_end_idx + 1):
            cell = ws.cell(row=row, column=col)
            if cell.value is not None and isinstance(cell.value, (int, float)):
                values.append(cell.value)
    
    return values


def _get_range_all_values(ws, range_ref: str) -> list:
    """Get ALL values from a range (legacy, no visibility check)."""
    match = re.match(r'^([A-Z]+)(\d+):([A-Z]+)(\d+)$', range_ref.upper())
    if not match:
        raise ValueError(f"Invalid range reference: {range_ref}")
    
    col_start, row_start, col_end, row_end = match.groups()
    row_start, row_end = int(row_start), int(row_end)
    col_start_idx = column_index_from_string(col_start)
    col_end_idx = column_index_from_string(col_end)
    
    values = []
    for row in range(row_start, row_end + 1):
        for col in range(col_start_idx, col_end_idx + 1):
            cell = ws.cell(row=row, column=col)
            values.append(cell.value)
    
    return values


def execute_formula(formula: str, file_id: str, sheet_name: str = None) -> Any:
    """Execute a formula on the real spreadsheet data, respecting visibility."""
    if file_id not in spreadsheet_context["raw_bytes"]:
        return {"error": "File not found"}
    
    raw_bytes = spreadsheet_context["raw_bytes"][file_id]
    filename = get_filename_for_file_id(file_id)
    
    try:
        wb = openpyxl.load_workbook(BytesIO(raw_bytes), data_only=True)
        
        if not sheet_name:
            if len(wb.sheetnames) == 1:
                sheet_name = wb.sheetnames[0]
            else:
                wb.close()
                return {"error": f"Multiple sheets available: {wb.sheetnames}. Please specify sheet_name."}
        
        if sheet_name not in wb.sheetnames:
            wb.close()
            return {"error": f"Sheet '{sheet_name}' not found. Available: {wb.sheetnames}"}
        
        ws = wb[sheet_name]
        
        formula = formula.strip()
        if formula.startswith("="):
            formula = formula[1:]
        
        result = None
        
        # SUM - with visibility
        sum_match = re.match(r'SUM\(([A-Z]+\d+:[A-Z]+\d+)\)', formula, re.IGNORECASE)
        if sum_match:
            range_ref = sum_match.group(1)
            values = _get_range_values_with_visibility(ws, range_ref, file_id, filename, sheet_name)
            result = sum(values) if values else 0
        
        # AVERAGE - with visibility
        if result is None:
            avg_match = re.match(r'AVERAGE\(([A-Z]+\d+:[A-Z]+\d+)\)', formula, re.IGNORECASE)
            if avg_match:
                range_ref = avg_match.group(1)
                values = _get_range_values_with_visibility(ws, range_ref, file_id, filename, sheet_name)
                result = sum(values) / len(values) if values else 0
        
        # COUNT - with visibility
        if result is None:
            count_match = re.match(r'COUNT\(([A-Z]+\d+:[A-Z]+\d+)\)', formula, re.IGNORECASE)
            if count_match:
                range_ref = count_match.group(1)
                values = _get_range_values_with_visibility(ws, range_ref, file_id, filename, sheet_name)
                result = len(values)
        
        # MAX - with visibility
        if result is None:
            max_match = re.match(r'MAX\(([A-Z]+\d+:[A-Z]+\d+)\)', formula, re.IGNORECASE)
            if max_match:
                range_ref = max_match.group(1)
                values = _get_range_values_with_visibility(ws, range_ref, file_id, filename, sheet_name)
                result = max(values) if values else 0
        
        # MIN - with visibility
        if result is None:
            min_match = re.match(r'MIN\(([A-Z]+\d+:[A-Z]+\d+)\)', formula, re.IGNORECASE)
            if min_match:
                range_ref = min_match.group(1)
                values = _get_range_values_with_visibility(ws, range_ref, file_id, filename, sheet_name)
                result = min(values) if values else 0
        
        # Single cell - with visibility
        if result is None:
            cell_match = re.match(r'^([A-Z]+\d+)$', formula, re.IGNORECASE)
            if cell_match:
                cell_ref = cell_match.group(1)
                result = _get_cell_value_with_visibility(ws, cell_ref, file_id, filename, sheet_name)
        
        wb.close()
        
        if result is None:
            return {"error": f"Unsupported formula: {formula}"}
        
        if hasattr(result, 'item'):
            result = result.item()
        
        return result
        
    except Exception as e:
        return {"error": str(e)}


def execute_python_query(code: str, file_id: str) -> Any:
    """Execute Python/pandas code on the spreadsheet data, respecting visibility."""
    if file_id not in spreadsheet_context["raw_bytes"]:
        return {"error": "File not found"}
    
    raw_bytes = spreadsheet_context["raw_bytes"][file_id]
    filename = get_filename_for_file_id(file_id)
    
    try:
        wb = openpyxl.load_workbook(BytesIO(raw_bytes), data_only=True)
        
        sheets = {}
        for sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
            
            data = []
            for row in ws.iter_rows(values_only=True):
                data.append(list(row))
            
            if data:
                header_row_idx = 0
                max_text_count = 0
                for idx, row in enumerate(data[:15]):
                    text_count = sum(1 for v in row if isinstance(v, str) and v and not v.startswith('⚠') and not v.startswith('🔍'))
                    if text_count >= 3 and text_count > max_text_count:
                        max_text_count = text_count
                        header_row_idx = idx
                
                headers = data[header_row_idx] if header_row_idx < len(data) else data[0]
                df_data = data[header_row_idx + 1:] if header_row_idx + 1 < len(data) else []
                df = pd.DataFrame(df_data, columns=headers)
                sheets[sheet_name] = df
        
        worksheets = {name: wb[name] for name in wb.sheetnames}
        
        # Create visibility-aware helper functions that capture file_id and filename
        def cell(sheet: str, ref: str):
            """Get cell value, respecting visibility."""
            return _get_cell_value_with_visibility(worksheets[sheet], ref, file_id, filename, sheet)
        
        def range_values(sheet: str, range_ref: str):
            """Get numeric values from range, respecting visibility."""
            return _get_range_values_with_visibility(worksheets[sheet], range_ref, file_id, filename, sheet)
        
        def range_all(sheet: str, range_ref: str):
            """Get all values from range, respecting visibility."""
            return _get_range_all_values_with_visibility(worksheets[sheet], range_ref, file_id, filename, sheet)
        
        safe_globals = {
            "pd": pd,
            "sheets": sheets,
            "ws": worksheets,
            "cell": cell,
            "range_values": range_values,
            "range_all": range_all,
        }
        
        exec_globals = safe_globals.copy()
        
        code = code.strip()
        
        lines = []
        for line in code.split('\n'):
            if '#' in line:
                line = line.split('#')[0].rstrip()
            if line.strip():
                lines.append(line)
        
        clean_code = '\n'.join(lines)
        
        if not clean_code:
            return {"error": "Empty code after removing comments"}
        
        if '\n' not in clean_code and not any(kw in clean_code for kw in ['=', 'print(', 'for ', 'if ', 'while ']):
            result = eval(clean_code, exec_globals)
        else:
            lines = clean_code.split('\n')
            last_line = lines[-1].strip()
            
            is_assignment = '=' in last_line and not any(op in last_line for op in ['==', '!=', '<=', '>='])
            is_print = last_line.startswith('print(')
            
            if is_assignment or is_print:
                exec(clean_code, exec_globals)
                result = "Code executed successfully"
            else:
                if len(lines) > 1:
                    exec('\n'.join(lines[:-1]), exec_globals)
                result = eval(last_line, exec_globals)
        
        wb.close()
        
        if hasattr(result, 'item'):
            result = result.item()
        elif isinstance(result, pd.Series):
            result = result.tolist()
        elif isinstance(result, pd.DataFrame):
            result = result.to_dict('records')
        
        return result
        
    except Exception as e:
        return {"error": str(e)}


def get_file_id_by_name(filename: str) -> Optional[str]:
    """Find file_id by filename (partial match)"""
    for file_id, file_data in spreadsheet_context["files"].items():
        if filename.lower() in file_data["filename"].lower():
            return file_id
    if len(spreadsheet_context["files"]) == 1:
        return list(spreadsheet_context["files"].keys())[0]
    return None


def list_available_files() -> list[dict]:
    """List all loaded files and their sheets"""
    result = []
    for file_id, file_data in spreadsheet_context["files"].items():
        sheets_info = []
        for sheet_name, df in file_data["sheets"].items():
            sheets_info.append({
                "name": sheet_name,
                "rows": len(df),
                "columns": list(df.columns)
            })
        result.append({
            "file_id": file_id,
            "filename": file_data["filename"],
            "sheets": sheets_info
        })
    return result



# =============================================================================
# NEW: FRIENDLY ERROR RESPONSES
# =============================================================================

def friendly_error_response(error: Exception, context: dict = None) -> dict:
    """Convert technical errors into friendly, actionable messages."""
    context = context or {}
    error_str = str(error)
    error_type = type(error).__name__
    
    available_columns = context.get("available_columns", [])
    available_sheets = context.get("available_sheets", [])
    
    if "KeyError" in error_type or "not found" in error_str.lower() or "does not exist" in error_str.lower():
        if available_columns:
            col_list = ", ".join(available_columns[:8])
            if len(available_columns) > 8:
                col_list += f" (and {len(available_columns) - 8} more)"
            
            return {
                "type": "friendly_error",
                "icon": "🤔",
                "message": f"I couldn't find that column. Here's what I can see: {col_list}",
                "suggestions": [
                    f"What's the total {available_columns[0]}?" if available_columns else None,
                    "Show me all the column names",
                    "Give me a summary of the data"
                ]
            }
        return {
            "type": "friendly_error",
            "icon": "🤔",
            "message": "I couldn't find that column or field. Try asking me what columns are available.",
            "suggestions": ["What columns are in this spreadsheet?", "Show me the structure of this data"]
        }
    
    if "sheet" in error_str.lower() and ("not found" in error_str.lower() or "does not exist" in error_str.lower()):
        if available_sheets:
            return {
                "type": "friendly_error",
                "icon": "📑",
                "message": f"That sheet doesn't exist. Available sheets: {', '.join(available_sheets)}",
                "suggestions": [f"Show me data from {available_sheets[0]}" if available_sheets else None]
            }
    
    if "timeout" in error_str.lower() or "timed out" in error_str.lower():
        return {
            "type": "friendly_error",
            "icon": "⏱️",
            "message": "That calculation is taking too long. Try narrowing down your question.",
            "suggestions": ["Show me just the last 3 months", "What are the top 10 items?", "Give me a summary instead"]
        }
    
    if "rate limit" in error_str.lower() or "429" in error_str:
        return {
            "type": "friendly_error",
            "icon": "⏳",
            "message": "I'm getting too many requests right now. Please wait a moment and try again.",
            "suggestions": []
        }
    
    if "division" in error_str.lower() or "ZeroDivision" in error_type:
        return {
            "type": "friendly_error",
            "icon": "🔢",
            "message": "I ran into a math error (probably division by zero). The data might have some zeros where there shouldn't be.",
            "suggestions": ["Show me rows where values are zero", "Give me the raw totals instead"]
        }
    
    if "empty" in error_str.lower() or "no data" in error_str.lower():
        return {
            "type": "friendly_error",
            "icon": "📭",
            "message": "I didn't find any data matching that criteria. Try broadening your search.",
            "suggestions": ["Show me all the data", "What date range is in the file?"]
        }
    
    if "file not found" in error_str.lower() or "not loaded" in error_str.lower():
        return {
            "type": "friendly_error",
            "icon": "📁",
            "message": "I don't have a spreadsheet loaded. Please upload a file first.",
            "suggestions": []
        }
    
    return {
        "type": "friendly_error",
        "icon": "😅",
        "message": "Something went wrong with that request. Try rephrasing your question.",
        "suggestions": ["Give me a summary of this data", "What can you tell me about this spreadsheet?", "Show me the totals"]
    }


def extract_context_for_errors(file_id: str) -> dict:
    """Extract useful context from loaded spreadsheet for better error messages."""
    context = {"available_columns": [], "available_sheets": []}
    
    if file_id not in spreadsheet_context.get("files", {}):
        return context
    
    file_data = spreadsheet_context["files"][file_id]
    
    for sheet_name, df in file_data.get("sheets", {}).items():
        context["available_sheets"].append(sheet_name)
        context["available_columns"].extend([str(c) for c in df.columns.tolist()])
    
    context["available_columns"] = list(dict.fromkeys(context["available_columns"]))
    
    return context