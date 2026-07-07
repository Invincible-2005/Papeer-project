"""
Chat route — POST /api/chat

This endpoint is the bridge between the React frontend and the RAG pipeline.
It accepts a user message + session_id, runs the full LangGraph RAG workflow,
and returns the answer + graph state.

How it maps to the Streamlit app (app.py lines 350-398):
  Streamlit:  graph.stream(input_state, config, stream_mode="messages")
  FastAPI:    graph.invoke(input_state, config)  ← simpler, non-streaming version

The streaming version (SSE) will be added in Step 4.
"""

from fastapi import APIRouter, HTTPException
from langchain_core.messages import HumanMessage
from pydantic import BaseModel

from backend.rag_graph import build_graph, clean_content

router = APIRouter()

# ── Build the RAG graph once at startup ──────────────────────────────────────
# This is equivalent to Streamlit's @st.cache_resource decorator.
# The graph (and its SQLite checkpointer) are created once and reused
# for every request. The checkpointer stores chat history per session_id.
graph = build_graph()


# ── Request / Response schemas ───────────────────────────────────────────────
# These are Pydantic models — exactly what you've already learned!
# FastAPI uses them to:
#   1. Validate incoming JSON automatically
#   2. Generate API documentation (Swagger UI at /docs)
#   3. Serialize the response to JSON

class ChatRequest(BaseModel):
    """What the frontend sends to us."""
    message: str
    session_id: str


class ChatResponse(BaseModel):
    """What we send back to the frontend."""
    response: str
    route: str | None = None
    graph_state: dict = {}


# ── Helper: serialize graph state for JSON ───────────────────────────────────
# LangChain message objects and Document objects aren't JSON-serializable.
# This function converts them to plain dicts, just like app.py's
# _serialize_state() function (lines 39-61 in the Streamlit app).

def _serialize_state(values: dict) -> dict:
    out = {}
    for k, v in values.items():
        if k == "messages":
            out[k] = [
                {
                    "type": type(m).__name__,
                    "content": (
                        m.content[:300]
                        if isinstance(m.content, str)
                        else repr(m.content)[:300]
                    ),
                }
                for m in (v or [])
            ]
        elif k == "retrieved_docs":
            out[k] = [
                {"content": d.page_content[:300], "metadata": d.metadata}
                for d in (v or [])
            ]
        else:
            try:
                # Ensure the value is JSON-serializable
                import json
                json.dumps(v)
                out[k] = v
            except (TypeError, ValueError):
                out[k] = str(v)
    return out


# ── The chat endpoint ────────────────────────────────────────────────────────

@router.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest):
    """
    Send a message and get a RAG-powered response.

    This is a sync function (not async def) ON PURPOSE:
    The RAG graph makes blocking calls to Gemini, Qdrant, and Tavily.
    FastAPI automatically runs sync endpoints in a thread pool,
    so the server stays responsive while waiting for these calls.
    """
    # Build the input state — same structure as app.py lines 350-363
    input_state = {
        "messages": [HumanMessage(content=request.message)],
        "session_id": request.session_id,
        "query": request.message,
        "route": None,
        "retrieved_docs": [],
        "retrieval_attempts": 0,
        "claim_verdict": None,
        "claim_source": None,
        "superseding_papers": [],
        "answer": None,
        "is_relevant": None,
        "rewrite_count": 0,
    }
    config = {"configurable": {"thread_id": request.session_id}}

    try:
        # Run the full RAG graph (router → retrieve/verify/direct → answer)
        result = graph.invoke(input_state, config)

        answer = clean_content(result.get("answer", "")) or "No response generated."
        route = result.get("route")
        state_snapshot = _serialize_state(result)

        return ChatResponse(
            response=answer,
            route=route,
            graph_state=state_snapshot,
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"RAG pipeline error: {str(e)}")


from fastapi.responses import StreamingResponse
import json

@router.post("/chat/stream")
def chat_stream(request: ChatRequest):
    """
    Stream the chat response via Server-Sent Events (SSE).
    """
    # Only need to initialize required fields, LangGraph fills the rest
    input_state = {
        "messages": [HumanMessage(content=request.message)],
        "session_id": request.session_id,
        "query": request.message,
    }
    config = {"configurable": {"thread_id": request.session_id}}

    def event_generator():
        try:
            # LangGraph's stream(..., stream_mode="messages") yields a tuple of 
            # (MessageChunk, Metadata) as the graph executes.
            for chunk, metadata in graph.stream(input_state, config, stream_mode="messages"):
                node = metadata.get("langgraph_node")
                
                # We only want to stream the actual tokens from the final node.
                # All other internal agent thoughts/tool calls are hidden.
                if node == "generate_answer":
                    type_name = type(chunk).__name__
                    if type_name == "AIMessageChunk":
                        content = clean_content(chunk.content)
                        if content:
                            # Standard SSE format: data: {"chunk": "..."} \n\n
                            yield f"data: {json.dumps({'chunk': content})}\n\n"
                            
            # Yield a finish marker so the frontend knows it's complete
            yield f"data: {json.dumps({'status': 'done'})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    # Return a streaming response instead of standard JSON
    return StreamingResponse(event_generator(), media_type="text/event-stream")
