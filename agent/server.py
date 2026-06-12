"""
FastAPI server — exposes the financial planning agent as an API.

Endpoints:
  POST /api/chat        — Send a message, get agent response
  GET  /api/profile     — Get current financial profile
  PUT  /api/profile     — Update financial profile
  GET  /api/reports     — Get all saved report items
  POST /api/reports     — Save a visualization to the report
  DELETE /api/reports/{id} — Remove a saved visualization
  GET  /api/health      — Health check
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pathlib import Path
import json
import re
import uuid
from datetime import datetime

from agent.main import create_agent, _ensure_profile_exists
from agent.profile import FinancialProfile

app = FastAPI(
    title="Financial Planning Agent API",
    version="1.0.0",
    description="AI-powered financial planning with skill-based architecture",
)

# CORS — allow the React dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── State ─────────────────────────────────────────────────────────────────────

# Single agent instance with conversation memory
_agent = None


def _get_agent():
    global _agent
    if _agent is None:
        _ensure_profile_exists()
        _agent = create_agent()
    return _agent


# ─── Models ────────────────────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    message: str


class ChatResponse(BaseModel):
    response: str
    tool_calls: list[str] = []
    visualizations: list[dict] = []


class HealthResponse(BaseModel):
    status: str
    profile_loaded: bool
    skills: list[str]


# ─── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/api/health", response_model=HealthResponse)
def health_check():
    profile_exists = Path("profile.json").exists()
    return HealthResponse(
        status="ok",
        profile_loaded=profile_exists,
        skills=["cash_flow", "asset_location"],
    )


@app.post("/api/chat", response_model=ChatResponse)
def chat(request: ChatRequest):
    """Send a message to the financial planning agent."""
    if not request.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    agent = _get_agent()

    try:
        response = agent(request.message)
        response_text = str(response)

        # Extract vega-lite specs from the response
        visualizations = []
        vega_pattern = r"```vega-lite\n(.*?)```"
        matches = re.findall(vega_pattern, response_text, re.DOTALL)
        for match in matches:
            try:
                spec = json.loads(match.strip())
                visualizations.append(spec)
            except json.JSONDecodeError:
                pass

        # Clean the response text (remove the raw JSON blocks for cleaner display)
        clean_text = re.sub(vega_pattern, "[Chart rendered below]", response_text, flags=re.DOTALL)

        return ChatResponse(
            response=clean_text,
            tool_calls=[],
            visualizations=visualizations,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Agent error: {str(e)}")


@app.post("/api/chat/reset")
def reset_chat():
    """Reset conversation history (start fresh)."""
    global _agent
    _agent = None
    return {"status": "reset", "message": "Conversation history cleared."}


@app.get("/api/profile")
def get_profile():
    """Return the current financial profile as JSON."""
    _ensure_profile_exists()
    profile = FinancialProfile.load("profile.json")
    return profile.to_dict()


@app.put("/api/profile")
def update_profile(data: dict):
    """Update the financial profile. Accepts a full or partial profile dict."""
    try:
        # Load existing, merge updates, save
        profile_path = Path("profile.json")
        if profile_path.exists():
            existing = json.loads(profile_path.read_text())
            existing.update(data)
            profile_path.write_text(json.dumps(existing, indent=2))
        else:
            profile_path.write_text(json.dumps(data, indent=2))

        return {"status": "updated", "message": "Profile saved."}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to update profile: {str(e)}")


# ─── Reports Persistence ───────────────────────────────────────────────────────

REPORTS_FILE = Path("reports.json")


def _load_reports() -> list[dict]:
    if REPORTS_FILE.exists():
        return json.loads(REPORTS_FILE.read_text())
    return []


def _save_reports(reports: list[dict]) -> None:
    REPORTS_FILE.write_text(json.dumps(reports, indent=2))


class SaveReportItemRequest(BaseModel):
    chart_type: str
    title: str
    description: str = ""


class ReportItem(BaseModel):
    id: str
    chart_type: str
    title: str
    description: str
    created_at: str
    position: int


@app.get("/api/reports", response_model=list[ReportItem])
def get_reports():
    """Get all saved report visualizations."""
    return _load_reports()


@app.post("/api/reports", response_model=ReportItem)
def save_report_item(request: SaveReportItemRequest):
    """Save a visualization to the persistent report dashboard."""
    reports = _load_reports()

    item = {
        "id": str(uuid.uuid4())[:8],
        "chart_type": request.chart_type,
        "title": request.title,
        "description": request.description,
        "created_at": datetime.now().isoformat(),
        "position": len(reports),
    }

    reports.append(item)
    _save_reports(reports)
    return item


@app.delete("/api/reports/{item_id}")
def delete_report_item(item_id: str):
    """Remove a visualization from the saved report."""
    reports = _load_reports()
    original_len = len(reports)
    reports = [r for r in reports if r["id"] != item_id]

    if len(reports) == original_len:
        raise HTTPException(status_code=404, detail=f"Report item '{item_id}' not found")

    # Re-number positions
    for i, r in enumerate(reports):
        r["position"] = i

    _save_reports(reports)
    return {"status": "deleted", "id": item_id}


@app.put("/api/reports/reorder")
def reorder_reports(order: list[str]):
    """Reorder report items. Pass list of IDs in desired order."""
    reports = _load_reports()
    id_to_item = {r["id"]: r for r in reports}

    reordered = []
    for i, item_id in enumerate(order):
        if item_id in id_to_item:
            item = id_to_item[item_id]
            item["position"] = i
            reordered.append(item)

    # Append any items not in the order list at the end
    for r in reports:
        if r["id"] not in order:
            r["position"] = len(reordered)
            reordered.append(r)

    _save_reports(reordered)
    return {"status": "reordered", "count": len(reordered)}


@app.get("/api/reports/{item_id}/render")
def render_report_item(item_id: str):
    """Generate a fresh Vega-Lite spec for a saved report item using current profile data."""
    reports = _load_reports()
    item = next((r for r in reports if r["id"] == item_id), None)
    if not item:
        raise HTTPException(status_code=404, detail=f"Report item '{item_id}' not found")

    # Import the spec builder from the visualization skill
    from agent.skills.visualization.tools import _build_spec, _load_profile
    profile = _load_profile()
    spec = _build_spec(item["chart_type"], item["title"], profile)
    return spec


# ─── Run ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
