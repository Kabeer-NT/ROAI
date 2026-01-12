"""
Spreadsheet Service - Relationship-Based Approach
=================================================
LLM sees ONLY structure (headers, labels, formulas, cell types).
LLM generates formulas/code to answer questions.
We execute locally on real data and return results.

OPTION B: Use openpyxl directly for execution - cell references just work.
"""

import pandas as pd
import openpyxl
from openpyxl.utils import get_column_letter, column_index_from_string
import re
import json
from typing import Optional, Any
from dataclasses import dataclass
from io import BytesIO


@dataclass
class SheetStructure:
    """Structural representation of a sheet - NO numeric values"""
    name: str
    rows: int
    cols: int
    headers: dict[str, str]  # cell_address -> header text (e.g., "C4" -> "Shares Held")
    row_labels: dict[str, str]  # cell_address -> label text (column A)
    text_values: dict[str, str]  # cell_address -> any text value (for display)
    formulas: dict[str, str]  # cell_address -> formula
    cell_types: dict[str, str]  # cell_address -> "numeric", "text", "formula", "empty"


# Global storage
spreadsheet_context: dict = {
    "files": {},           # file_id -> {filename, sheets: {name -> DataFrame}}
    "structures": {},      # file_id -> {sheet_name -> SheetStructure}
    "raw_bytes": {},       # file_id -> original file bytes (for openpyxl execution)
}


def clear_context():
    spreadsheet_context["files"] = {}
    spreadsheet_context["structures"] = {}
    spreadsheet_context["raw_bytes"] = {}


def extract_structure_from_excel(file_bytes: bytes) -> dict[str, SheetStructure]:
    """
    Extract structure from Excel file including formulas.
    Detects header rows automatically and maps cell addresses.
    """
    structures = {}
    
    try:
        wb = openpyxl.load_workbook(BytesIO(file_bytes), data_only=False)
        wb_values = openpyxl.load_workbook(BytesIO(file_bytes), data_only=True)
        
        for sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
            ws_values = wb_values[sheet_name]
            
            formulas = {}
            cell_types = {}
            headers = {}  # Now maps cell address -> header text
            row_labels = {}  # Maps cell address -> label text
            text_values = {}  # ALL text values for grid display
            
            max_row = ws.max_row or 1
            max_col = ws.max_column or 1
            
            # First pass: find the header row (row with most text cells that look like column names)
            header_row = None
            max_header_score = 0
            
            for row_idx in range(1, min(max_row + 1, 15)):
                text_count = 0
                non_empty_count = 0
                for col_idx in range(1, max_col + 1):
                    value = ws_values.cell(row=row_idx, column=col_idx).value
                    if value is not None and value != "":
                        non_empty_count += 1
                        if isinstance(value, str) and not value.startswith("⚠") and not value.startswith("🔍"):
                            text_count += 1
                
                # Score: prefer rows with many text cells (likely headers)
                if text_count >= 3 and text_count > max_header_score:
                    max_header_score = text_count
                    header_row = row_idx
            
            # Second pass: extract structure
            for row_idx in range(1, max_row + 1):
                for col_idx in range(1, max_col + 1):
                    cell = ws.cell(row=row_idx, column=col_idx)
                    cell_addr = f"{get_column_letter(col_idx)}{row_idx}"
                    value_cell = ws_values.cell(row=row_idx, column=col_idx)
                    value = value_cell.value
                    
                    # Check for formula
                    if cell.value and isinstance(cell.value, str) and cell.value.startswith("="):
                        formulas[cell_addr] = cell.value
                        cell_types[cell_addr] = "formula"
                    elif value is None or value == "":
                        cell_types[cell_addr] = "empty"
                    elif isinstance(value, (int, float)):
                        cell_types[cell_addr] = "numeric"
                    else:
                        cell_types[cell_addr] = "text"
                        # Store ALL text values for grid display
                        text_values[cell_addr] = str(value)[:100]  # Limit length
                    
                    # Record headers (from detected header row)
                    if row_idx == header_row and value is not None and isinstance(value, str):
                        headers[cell_addr] = str(value)
                    
                    # Record row labels (first column text values, below header)
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
    """
    Add file to context. Store raw bytes for execution, structure for LLM.
    """
    spreadsheet_context["files"][file_id] = {
        "filename": filename,
        "sheets": sheets
    }
    spreadsheet_context["raw_bytes"][file_id] = file_bytes
    
    # Extract structure based on file type
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


def build_llm_context() -> str:
    """
    Build context for LLM showing ONLY structure - NO numeric values.
    Shows exact cell addresses so Claude can reference them directly.
    """
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
            parts.append(f"Size: {structure.rows} rows × {structure.cols} columns\n")
            
            # Show headers with exact cell addresses
            if structure.headers:
                parts.append("**Column Headers:**")
                for cell_addr, header_text in sorted(structure.headers.items(), key=lambda x: column_index_from_string(x[0].rstrip('0123456789'))):
                    parts.append(f"  {cell_addr}: {header_text}")
            
            # Show row labels with exact cell addresses
            if structure.row_labels:
                parts.append(f"\n**Row Labels (column A):**")
                items = list(structure.row_labels.items())[:25]
                for cell_addr, label in items:
                    parts.append(f"  {cell_addr}: {label}")
                if len(structure.row_labels) > 25:
                    parts.append(f"  ... and {len(structure.row_labels) - 25} more rows")
            
            # Show data range
            if structure.headers:
                header_cells = list(structure.headers.keys())
                if header_cells:
                    # Find the header row number
                    header_row = int(re.search(r'\d+', header_cells[0]).group())
                    data_start_row = header_row + 1
                    
                    # Find last data row (last row with numeric data before totals/notes)
                    last_data_row = structure.rows
                    parts.append(f"\n**Data Range:** Row {data_start_row} to ~Row {last_data_row} (check row labels for actual data rows)")
            
            # Show formulas
            if structure.formulas:
                parts.append(f"\n**Existing Formulas:**")
                for cell_addr, formula in list(structure.formulas.items())[:15]:
                    parts.append(f"  {cell_addr}: {formula}")
                if len(structure.formulas) > 15:
                    parts.append(f"  ... and {len(structure.formulas) - 15} more formulas")
            
            # Show cell type summary
            type_counts = {}
            for cell_type in structure.cell_types.values():
                type_counts[cell_type] = type_counts.get(cell_type, 0) + 1
            parts.append(f"\n**Cell Types:** {json.dumps(type_counts)}")
        
        parts.append("")
    
    return "\n".join(parts)


def _get_cell_value(ws, cell_ref: str) -> Any:
    """Get value from a cell reference like 'C5'."""
    match = re.match(r'^([A-Z]+)(\d+)$', cell_ref.upper())
    if not match:
        raise ValueError(f"Invalid cell reference: {cell_ref}")
    
    col_letter, row_num = match.groups()
    return ws[cell_ref].value


def _get_range_values(ws, range_ref: str) -> list:
    """Get values from a range like 'C5:C10'."""
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


def execute_formula(formula: str, file_id: str, sheet_name: str = None) -> Any:
    """
    Execute a formula on the real spreadsheet data using openpyxl.
    Cell references match exactly what's in the file - no offset confusion.
    """
    if file_id not in spreadsheet_context["raw_bytes"]:
        return {"error": "File not found"}
    
    raw_bytes = spreadsheet_context["raw_bytes"][file_id]
    
    try:
        wb = openpyxl.load_workbook(BytesIO(raw_bytes), data_only=True)
        
        # Auto-detect sheet if not specified
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
        
        # Clean up formula
        formula = formula.strip()
        if formula.startswith("="):
            formula = formula[1:]
        
        result = None
        
        # SUM formula
        sum_match = re.match(r'SUM\(([A-Z]+\d+:[A-Z]+\d+)\)', formula, re.IGNORECASE)
        if sum_match:
            range_ref = sum_match.group(1)
            values = _get_range_values(ws, range_ref)
            result = sum(values) if values else 0
        
        # AVERAGE formula
        if result is None:
            avg_match = re.match(r'AVERAGE\(([A-Z]+\d+:[A-Z]+\d+)\)', formula, re.IGNORECASE)
            if avg_match:
                range_ref = avg_match.group(1)
                values = _get_range_values(ws, range_ref)
                result = sum(values) / len(values) if values else 0
        
        # COUNT formula
        if result is None:
            count_match = re.match(r'COUNT\(([A-Z]+\d+:[A-Z]+\d+)\)', formula, re.IGNORECASE)
            if count_match:
                range_ref = count_match.group(1)
                values = _get_range_values(ws, range_ref)
                result = len(values)
        
        # MAX formula
        if result is None:
            max_match = re.match(r'MAX\(([A-Z]+\d+:[A-Z]+\d+)\)', formula, re.IGNORECASE)
            if max_match:
                range_ref = max_match.group(1)
                values = _get_range_values(ws, range_ref)
                result = max(values) if values else 0
        
        # MIN formula
        if result is None:
            min_match = re.match(r'MIN\(([A-Z]+\d+:[A-Z]+\d+)\)', formula, re.IGNORECASE)
            if min_match:
                range_ref = min_match.group(1)
                values = _get_range_values(ws, range_ref)
                result = min(values) if values else 0
        
        # Single cell reference
        if result is None:
            cell_match = re.match(r'^([A-Z]+\d+)$', formula, re.IGNORECASE)
            if cell_match:
                cell_ref = cell_match.group(1)
                result = _get_cell_value(ws, cell_ref)
        
        wb.close()
        
        if result is None:
            return {"error": f"Unsupported formula: {formula}"}
        
        # Convert numpy types to Python types
        if hasattr(result, 'item'):
            result = result.item()
        
        return result
        
    except Exception as e:
        return {"error": str(e)}


def execute_python_query(code: str, file_id: str) -> Any:
    """
    Execute Python/pandas code on the spreadsheet data.
    For complex queries that can't be expressed as simple formulas.
    
    The 'sheets' dict contains DataFrames, but also provides 'ws' for direct cell access.
    """
    if file_id not in spreadsheet_context["raw_bytes"]:
        return {"error": "File not found"}
    
    raw_bytes = spreadsheet_context["raw_bytes"][file_id]
    
    try:
        # Load workbook for direct cell access
        wb = openpyxl.load_workbook(BytesIO(raw_bytes), data_only=True)
        
        # Create sheets dict with both DataFrame and cell accessor
        sheets = {}
        for sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
            
            # Convert to DataFrame with proper header detection
            data = []
            for row in ws.iter_rows(values_only=True):
                data.append(list(row))
            
            if data:
                # Find header row (row with most non-empty string values)
                header_row_idx = 0
                max_text_count = 0
                for idx, row in enumerate(data[:15]):  # Check first 15 rows
                    text_count = sum(1 for v in row if isinstance(v, str) and v and not v.startswith('⚠') and not v.startswith('🔍'))
                    if text_count >= 3 and text_count > max_text_count:
                        max_text_count = text_count
                        header_row_idx = idx
                
                # Use detected header row
                headers = data[header_row_idx] if header_row_idx < len(data) else data[0]
                df_data = data[header_row_idx + 1:] if header_row_idx + 1 < len(data) else []
                df = pd.DataFrame(df_data, columns=headers)
                sheets[sheet_name] = df
        
        # Also provide direct worksheet access
        worksheets = {name: wb[name] for name in wb.sheetnames}
        
        # Helper function to get cell value
        def cell(sheet: str, ref: str):
            return worksheets[sheet][ref].value
        
        # Helper function to get range values
        def range_values(sheet: str, range_ref: str):
            return _get_range_values(worksheets[sheet], range_ref)
        
        # Create safe execution environment
        safe_globals = {
            "pd": pd,
            "sheets": sheets,
            "ws": worksheets,
            "cell": cell,
            "range_values": range_values,
        }
        
        # Execute and capture result
        exec_globals = safe_globals.copy()
        
        # Handle multi-line code: execute all, return last expression
        code = code.strip()
        
        # Remove comments from code to avoid syntax issues
        lines = []
        for line in code.split('\n'):
            # Remove inline comments but keep the code part
            if '#' in line:
                line = line.split('#')[0].rstrip()
            if line.strip():
                lines.append(line)
        
        clean_code = '\n'.join(lines)
        
        if not clean_code:
            return {"error": "Empty code after removing comments"}
        
        # If it's a simple single expression, just eval it
        if '\n' not in clean_code and not any(kw in clean_code for kw in ['=', 'print(', 'for ', 'if ', 'while ']):
            result = eval(clean_code, exec_globals)
        else:
            # Multi-line or has statements: exec everything, capture last line
            lines = clean_code.split('\n')
            last_line = lines[-1].strip()
            
            # Check if last line is an expression (not an assignment or print)
            is_assignment = '=' in last_line and not any(op in last_line for op in ['==', '!=', '<=', '>='])
            is_print = last_line.startswith('print(')
            
            if is_assignment or is_print:
                # Just exec everything
                exec(clean_code, exec_globals)
                result = "Code executed successfully"
            else:
                # Exec all but last line, then eval last line
                if len(lines) > 1:
                    exec('\n'.join(lines[:-1]), exec_globals)
                result = eval(last_line, exec_globals)
        
        wb.close()
        
        # Convert numpy/pandas types
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