import json
import uuid
from datetime import datetime
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.rag_graph import build_graph, clean_content
from langchain_google_genai import ChatGoogleGenerativeAI

router = APIRouter()

SESSIONS_FILE = Path("sessions.json")
_rename_llm = ChatGoogleGenerativeAI(model="gemini-3.1-flash-lite")

# Share the same graph instance (it connects to the same sqlite checkpointer DB)
graph = build_graph()

# ── Schemas ──────────────────────────────────────────────────────────────────

class SessionMeta(BaseModel):
    id: str
    name: str
    created_at: str
    is_named: bool

class SessionCreateResponse(BaseModel):
    session_id: str

class RenameRequest(BaseModel):
    first_message: str

# ── Helper Functions ─────────────────────────────────────────────────────────

def load_sessions() -> dict:
    try:
        return json.loads(SESSIONS_FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}

def save_sessions(sessions_meta: dict) -> None:
    SESSIONS_FILE.write_text(json.dumps(sessions_meta, indent=2), encoding="utf-8")

# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/", response_model=list[SessionMeta])
def list_sessions():
    """List all sessions, sorted by newest first."""
    sessions = load_sessions()
    sorted_sessions = sorted(
        sessions.values(),
        key=lambda s: s["created_at"],
        reverse=True,
    )
    return sorted_sessions

@router.post("/", response_model=SessionCreateResponse)
def create_session():
    """Create a new empty session."""
    sid = str(uuid.uuid4())
    sessions = load_sessions()
    sessions[sid] = {
        "id": sid,
        "name": "New Session",
        "created_at": datetime.now().isoformat(),
        "is_named": False,
    }
    save_sessions(sessions)
    return {"session_id": sid}

@router.post("/{session_id}/rename")
def rename_session(session_id: str, req: RenameRequest):
    """Auto-rename a session using an LLM based on the first message."""
    sessions = load_sessions()
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    if sessions[session_id].get("is_named"):
        return {"name": sessions[session_id]["name"]}
        
    try:
        response = _rename_llm.invoke(
            [
                {
                    "role": "system",
                    "content": (
                        "Generate a concise 3-5 word title for a research chat session "
                        "based on the user's first message. Return only the title, "
                        "no punctuation at the end, no quotes."
                    ),
                },
                {"role": "user", "content": req.first_message[:500]},
            ]
        )
        name = clean_content(response.content).strip()
    except Exception:
        name = "New Session"
        
    sessions[session_id]["name"] = name
    sessions[session_id]["is_named"] = True
    save_sessions(sessions)
    return {"name": name}

@router.get("/{session_id}/messages")
def get_session_messages(session_id: str):
    """Fetch chat history from the LangGraph SQLite checkpointer."""
    config = {"configurable": {"thread_id": session_id}}
    try:
        state = graph.get_state(config)
        if not state or not state.values:
            return []
            
        chats = []
        turn = 0
        for msg in state.values.get("messages", []):
            type_name = type(msg).__name__
            content = clean_content(msg.content)
            
            if type_name == "HumanMessage":
                chats.append({"role": "user", "content": content})
            elif type_name in ("AIMessage", "AIMessageChunk"):
                turn += 1
                chats.append({"role": "assistant", "content": content, "turn": turn, "graph_state": {}})
                
        return chats
    except Exception as e:
        print(f"Error loading messages: {e}")
        return []
