import pandas as pd

spreadsheet_context: dict = {"files": {}}


def clear_context():
    spreadsheet_context["files"] = {}


def add_file_to_context(file_id: str, filename: str, sheets: dict[str, pd.DataFrame]):
    spreadsheet_context["files"][file_id] = {
        "filename": filename,
        "sheets": sheets
    }


def remove_file_from_context(file_id: str):
    if file_id in spreadsheet_context["files"]:
        del spreadsheet_context["files"][file_id]


def build_llm_context() -> str:
    if not spreadsheet_context["files"]:
        return ""
    
    parts = ["# SPREADSHEET DATA"]
    
    for file_id, file_data in spreadsheet_context["files"].items():
        parts.append(f"\n## File: {file_data['filename']}")
        
        for sheet_name, df in file_data["sheets"].items():
            parts.append(f"\n### Sheet: {sheet_name}")
            parts.append(f"### {len(df)} rows × {len(df.columns)} columns")
            parts.append("")
            parts.append(df.to_csv(index=False))
    
    return "\n".join(parts)
