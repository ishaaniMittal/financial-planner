"""
FastAPI server — exposes the financial planning agent as an API.

Endpoints:
  POST /api/chat       — Send a message, get agent response
  GET  /api/profile    — Get current financial profile
  PUT  /api/profile    — Update financial profile
  GET  /api/health     — Health check
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pathlib import Path
import json

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
        return ChatResponse(
            response=str(response),
            tool_calls=[],  # Could extract from agent internals if needed
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


# ─── Run ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
