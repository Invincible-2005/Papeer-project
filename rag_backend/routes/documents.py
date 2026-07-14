"""
Document routes — /api/documents

Three ways to load documents (1:1 with the Streamlit sidebar):
  1. File upload (PDF, TXT, Markdown)
  2. Web URL
  3. ArXiv paper (by ID or title)

Each endpoint chunks the document and adds it to the Qdrant vector store
scoped to the given session_id.
"""

import tempfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pydantic import BaseModel

from backend.paper_loader import load_document, load_webpage, load_arxiv
from backend.vector_store import add_paper, list_papers

router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────────────────────

class UrlLoadRequest(BaseModel):
    url: str
    session_id: str

class ArxivLoadRequest(BaseModel):
    query: str          # ArXiv ID (e.g. "1706.03762") or paper title
    session_id: str

class DocumentInfo(BaseModel):
    title: str

class LoadResponse(BaseModel):
    message: str
    title: str
    chunk_count: int


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/upload", response_model=LoadResponse)
def upload_file(
    file: UploadFile = File(...),
    session_id: str = Form(...),
):
    """
    Upload a PDF, TXT, or Markdown file.
    
    This uses multipart/form-data (not JSON), because we're sending a binary file.
    FastAPI's UploadFile handles the file, and Form() handles the session_id field.
    """
    allowed = {".pdf", ".txt", ".md", ".markdown"}
    suffix = Path(file.filename or "upload").suffix.lower()
    if suffix not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {suffix}. Allowed: {', '.join(allowed)}"
        )

    tmp_path = None
    try:
        # Save uploaded bytes to a temp file so LangChain loaders can read it
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            content = file.file.read()
            tmp.write(content)
            tmp_path = tmp.name

        docs = load_document(tmp_path)

        # Stamp the original filename as the title (same as Streamlit app)
        title = Path(file.filename or "upload").stem
        for doc in docs:
            doc.metadata["title"] = title

        add_paper(docs, session_id)

        return LoadResponse(
            message=f"Successfully loaded {file.filename}",
            title=title,
            chunk_count=len(docs),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process file: {str(e)}")
    finally:
        if tmp_path:
            Path(tmp_path).unlink(missing_ok=True)


@router.post("/url", response_model=LoadResponse)
def load_from_url(request: UrlLoadRequest):
    """Load a web page, chunk it, and add to the vector store."""
    try:
        docs = load_webpage(request.url)
        add_paper(docs, request.session_id)
        title = docs[0].metadata.get("title", request.url) if docs else request.url
        return LoadResponse(
            message=f"Successfully loaded URL",
            title=title,
            chunk_count=len(docs),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load URL: {str(e)}")


@router.post("/arxiv", response_model=LoadResponse)
def load_from_arxiv(request: ArxivLoadRequest):
    """Load an ArXiv paper by ID or title search."""
    try:
        docs = load_arxiv(request.query)
        add_paper(docs, request.session_id)
        title = docs[0].metadata.get("title", request.query) if docs else request.query
        return LoadResponse(
            message=f"Successfully loaded ArXiv paper",
            title=title,
            chunk_count=len(docs),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load ArXiv paper: {str(e)}")


@router.get("/{session_id}", response_model=list[DocumentInfo])
def get_documents(session_id: str):
    """List all documents loaded into a session's vector store."""
    try:
        titles = list_papers(session_id)
        return [DocumentInfo(title=t) for t in titles]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list documents: {str(e)}")
