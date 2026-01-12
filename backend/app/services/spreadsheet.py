"""
Spreadsheet Service - Relationship-Based Approach
=================================================
LLM sees ONLY structure (headers, labels, formulas, cell types).
LLM generates formulas/code to answer questions.
We execute locally on real data and return results.
"""

import pandas as pd
import openpyxl
from openpyxl.utils import get_column_letter
import re
import json
from typing import Optional, Any
from dataclasses import dataclass, field
from io import BytesIO


@dataclass
class SheetStructure:
    """Structural representation of a sheet - NO numeric values"""
    name: str
    rows: int
    cols: int
    headers: list[str]
    row_labels: list[str]
    formulas: dict[str, str]  # cell_address -> formula
    cell_types: dict[str, str]  # cell_address -> "numeric", "text", "formula", "empty"
    sample_text_values: dict[str, str]  # Only text/label values, no numbers


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


def _extract_cell_references(formula: str) -> list[str]:
    """Extract cell references from a formula string"""
    pattern = r"(?:\'?[\w\s]+\'?!)?\$?[A-Z]{1,3}\$?\d+"
    matches = re.findall(pattern, formula, re.IGNORECASE)
    normalized = []
    for match in matches:
        if "!" in match:
            match = match.split("!")[-1]
        match = match.replace("$", "").upper()
        normalized.append(match)
    return normalized


def extract_structure_from_dataframe(df: pd.DataFrame, sheet_name: str) -> SheetStructure:
    """
    Extract structure from DataFrame - only types and labels, NO numeric values.
    """
    cell_types = {}
    sample_text = {}
    
    headers = [str(c) for c in df.columns.tolist()]
    
    for col_idx, col_name in enumerate(df.columns):
        col_letter = get_column_letter(col_idx + 1)
        cell_types[f"{col_letter}1"] = "header"
        sample_text[f"{col_letter}1"] = str(col_name)
        
        for row_idx, value in enumerate(df[col_name], start=2):
            cell_addr = f"{col_letter}{row_idx}"
            
            if pd.isna(value):
                cell_types[cell_addr] = "empty"
            elif isinstance(value, (int, float)):
                cell_types[cell_addr] = "numeric"
                # DO NOT store the value
            else:
                cell_types[cell_addr] = "text"
                sample_text[cell_addr] = str(value)[:50]  # Store text values (labels)
    
    # Extract row labels (first column text values)
    row_labels = []
    if len(df.columns) > 0:
        first_col = df.iloc[:, 0]
        for val in first_col:
            if pd.notna(val) and not isinstance(val, (int, float)):
                row_labels.append(str(val))
    
    return SheetStructure(
        name=sheet_name,
        rows=len(df) + 1,
        cols=len(df.columns),
        headers=headers,
        row_labels=row_labels,
        formulas={},  # CSV/TSV don't have formulas
        cell_types=cell_types,
        sample_text_values=sample_text
    )


def extract_structure_from_excel(file_bytes: bytes) -> dict[str, SheetStructure]:
    """
    Extract structure from Excel file including formulas.
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
            sample_text = {}
            headers = []
            row_labels = []
            
            max_row = ws.max_row or 1
            max_col = ws.max_column or 1
            
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
                        # DO NOT store numeric values
                    else:
                        cell_types[cell_addr] = "text"
                        sample_text[cell_addr] = str(value)[:50]
                    
                    # Headers (first row)
                    if row_idx == 1 and value is not None:
                        headers.append(str(value))
                        sample_text[cell_addr] = str(value)
                    
                    # Row labels (first column, non-numeric)
                    if col_idx == 1 and row_idx > 1 and value is not None:
                        if not isinstance(value, (int, float)):
                            row_labels.append(str(value))
            
            structures[sheet_name] = SheetStructure(
                name=sheet_name,
                rows=max_row,
                cols=max_col,
                headers=headers,
                row_labels=row_labels,
                formulas=formulas,
                cell_types=cell_types,
                sample_text_values=sample_text
            )
        
        wb.close()
        wb_values.close()
        
    except Exception as e:
        print(f"Error extracting structure: {e}")
        
    return structures


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
            structures[sheet_name] = extract_structure_from_dataframe(df, sheet_name)
    
    spreadsheet_context["structures"][file_id] = structures


def remove_file_from_context(file_id: str):
    for store in ["files", "structures", "raw_bytes"]:
        if file_id in spreadsheet_context[store]:
            del spreadsheet_context[store][file_id]


def build_llm_context() -> str:
    """
    Build context for LLM showing ONLY structure - NO numeric values.
    """
    if not spreadsheet_context["structures"]:
        return ""
    
    parts = ["# SPREADSHEET STRUCTURE (numeric values hidden)\n"]
    parts.append("You can reference cells and generate formulas. I will execute them and return results.\n")
    
    for file_id, file_data in spreadsheet_context["files"].items():
        filename = file_data["filename"]
        structures = spreadsheet_context["structures"].get(file_id, {})
        
        parts.append(f"## File: {filename}")
        
        for sheet_name, structure in structures.items():
            parts.append(f"\n### Sheet: {sheet_name}")
            parts.append(f"Size: {structure.rows} rows × {structure.cols} columns\n")
            
            # Show headers with column letters
            if structure.headers:
                header_map = []
                for i, h in enumerate(structure.headers):
                    col_letter = get_column_letter(i + 1)
                    header_map.append(f"{col_letter}: {h}")
                parts.append(f"**Columns:** {', '.join(header_map)}")
            
            # Show row labels with row numbers
            if structure.row_labels:
                parts.append(f"\n**Row labels (column A):**")
                for i, label in enumerate(structure.row_labels[:30], start=2):
                    parts.append(f"  Row {i}: {label}")
                if len(structure.row_labels) > 30:
                    parts.append(f"  ... and {len(structure.row_labels) - 30} more rows")
            
            # Show formulas
            if structure.formulas:
                parts.append(f"\n**Existing formulas:**")
                for cell_addr, formula in list(structure.formulas.items())[:20]:
                    parts.append(f"  {cell_addr}: {formula}")
                if len(structure.formulas) > 20:
                    parts.append(f"  ... and {len(structure.formulas) - 20} more formulas")
            
            # Show cell type summary
            type_counts = {}
            for cell_type in structure.cell_types.values():
                type_counts[cell_type] = type_counts.get(cell_type, 0) + 1
            parts.append(f"\n**Cell types:** {json.dumps(type_counts)}")
        
        parts.append("")
    
    return "\n".join(parts)


def execute_formula(formula: str, file_id: str, sheet_name: str) -> Any:
    """
    Execute a formula on the real spreadsheet data.
    Returns the computed result.
    """
    if file_id not in spreadsheet_context["files"]:
        return {"error": "File not found"}
    
    sheets = spreadsheet_context["files"][file_id]["sheets"]
    if sheet_name not in sheets:
        return {"error": f"Sheet '{sheet_name}' not found"}
    
    df = sheets[sheet_name]
    
    # Handle common formula patterns
    formula = formula.strip()
    if formula.startswith("="):
        formula = formula[1:]
    
    try:
        # SUM formula
        sum_match = re.match(r'SUM\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)', formula, re.IGNORECASE)
        if sum_match:
            col_start, row_start, col_end, row_end = sum_match.groups()
            col_idx = ord(col_start.upper()) - ord('A')
            row_start, row_end = int(row_start) - 2, int(row_end) - 1  # -2 for header and 0-index
            values = df.iloc[row_start:row_end, col_idx]
            return float(values.sum())
        
        # AVERAGE formula
        avg_match = re.match(r'AVERAGE\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)', formula, re.IGNORECASE)
        if avg_match:
            col_start, row_start, col_end, row_end = avg_match.groups()
            col_idx = ord(col_start.upper()) - ord('A')
            row_start, row_end = int(row_start) - 2, int(row_end) - 1
            values = df.iloc[row_start:row_end, col_idx]
            return float(values.mean())
        
        # Single cell reference
        cell_match = re.match(r'^([A-Z]+)(\d+)$', formula, re.IGNORECASE)
        if cell_match:
            col, row = cell_match.groups()
            col_idx = ord(col.upper()) - ord('A')
            row_idx = int(row) - 2  # -2 for header and 0-index
            return df.iloc[row_idx, col_idx]
        
        # COUNT formula
        count_match = re.match(r'COUNT\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)', formula, re.IGNORECASE)
        if count_match:
            col_start, row_start, col_end, row_end = count_match.groups()
            col_idx = ord(col_start.upper()) - ord('A')
            row_start, row_end = int(row_start) - 2, int(row_end) - 1
            values = df.iloc[row_start:row_end, col_idx]
            return int(values.count())
        
        # MAX formula
        max_match = re.match(r'MAX\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)', formula, re.IGNORECASE)
        if max_match:
            col_start, row_start, col_end, row_end = max_match.groups()
            col_idx = ord(col_start.upper()) - ord('A')
            row_start, row_end = int(row_start) - 2, int(row_end) - 1
            values = df.iloc[row_start:row_end, col_idx]
            return float(values.max())
        
        # MIN formula
        min_match = re.match(r'MIN\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)', formula, re.IGNORECASE)
        if min_match:
            col_start, row_start, col_end, row_end = min_match.groups()
            col_idx = ord(col_start.upper()) - ord('A')
            row_start, row_end = int(row_start) - 2, int(row_end) - 1
            values = df.iloc[row_start:row_end, col_idx]
            return float(values.min())
        
        return {"error": f"Unsupported formula: {formula}"}
        
    except Exception as e:
        return {"error": str(e)}


def execute_python_query(code: str, file_id: str) -> Any:
    """
    Execute Python/pandas code on the spreadsheet data.
    Safer alternative to formulas for complex queries.
    """
    if file_id not in spreadsheet_context["files"]:
        return {"error": "File not found"}
    
    sheets = spreadsheet_context["files"][file_id]["sheets"]
    
    # Create a safe execution environment
    safe_globals = {
        "pd": pd,
        "sheets": sheets,
    }
    
    try:
        # Execute and capture result
        exec_globals = safe_globals.copy()
        exec(f"__result__ = {code}", exec_globals)
        return exec_globals.get("__result__")
    except Exception as e:
        return {"error": str(e)}


def get_file_id_by_name(filename: str) -> Optional[str]:
    """Find file_id by filename (partial match)"""
    for file_id, file_data in spreadsheet_context["files"].items():
        if filename.lower() in file_data["filename"].lower():
            return file_id
    # Return first file if only one exists
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