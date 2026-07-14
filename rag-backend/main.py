"""
Papeer RAG Backend — FastAPI entry point.

Run with:  uvicorn main:app --reload
Docs at:   http://localhost:8000/docs  (auto-generated Swagger UI)

This file does 3 things:
  1. Creates the FastAPI app
  2. Adds CORS middleware (so React on port 5173 can call this API on port 8000)
  3. Mounts the route modules (chat, sessions, documents — added in later steps)
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routes.chat import router as chat_router
from routes.sessions import router as sessions_router
from routes.documents import router as documents_router
from routes.btw import router as btw_router

# ── Create the app ───────────────────────────────────────────────────────────

app = FastAPI(
    title="Papeer RAG Backend",
    description="Research Paper Assistant — RAG-powered Q&A, claim verification, and web search.",
    version="0.1.0",
)


# ── CORS middleware ──────────────────────────────────────────────────────────
# Without this, the browser will BLOCK React (port 5173) from calling
# FastAPI (port 8000). This is a browser security feature called
# "Same-Origin Policy". CORS middleware tells the browser:
# "Yes, requests from localhost:5173 are allowed."

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],            # Allow all domains (so Vercel can access Render)
    allow_credentials=True,
    allow_methods=["*"],            # Allow all HTTP methods (GET, POST, etc.)
    allow_headers=["*"],            # Allow all headers
)


# ── Mount routes ─────────────────────────────────────────────────────────────
# Each router is a group of related endpoints defined in routes/*.py.
# The prefix="/api" means all endpoints start with /api/...
#   e.g. router.post("/chat") becomes POST /api/chat

app.include_router(chat_router, prefix="/api", tags=["Chat"])
app.include_router(sessions_router, prefix="/api/sessions", tags=["Sessions"])
app.include_router(documents_router, prefix="/api/documents", tags=["Documents"])
app.include_router(btw_router, prefix="/api", tags=["BTW"])


# ── Health check ─────────────────────────────────────────────────────────────
# Simple endpoint to verify the server is running.
# The React frontend will call this on startup to show a
# "Connected" / "Disconnected" indicator.

@app.get("/api/health", tags=["System"])
async def health_check():
    return {"status": "ok", "service": "papeer-rag-backend"}
