"""
BTW route — POST /api/btw

The "/btw" side channel: a lightweight, off-topic Q&A that never touches
the RAG pipeline, vector store, or session history. It's like a quick
aside — "by the way, what is X?" — answered directly by the LLM,
optionally augmented with a live web search.

This is a 1:1 port of the Streamlit /btw handler (app.py lines 312-331).
"""

import json

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.btw_handler import handle_btw

router = APIRouter()


class BtwRequest(BaseModel):
    query: str


@router.post("/btw")
def btw_stream(request: BtwRequest):
    """
    Stream a side-channel answer via SSE.
    Not saved to any session history.
    """
    def event_generator():
        try:
            for chunk in handle_btw(request.query):
                if chunk:
                    yield f"data: {json.dumps({'chunk': chunk})}\n\n"
            yield f"data: {json.dumps({'status': 'done'})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")
