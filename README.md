# Papeer — Research Paper Assistant

A conversational AI assistant for students and researchers to upload, explore, and verify academic papers through natural language chat.

---

## Project Description

Papeer is a decoupled Retrieval-Augmented Generation (RAG) application. The backend is built with **FastAPI**, **LangGraph**, and **LangChain**, while the frontend is a modern **React** Single Page Application using **Vite**, **TypeScript**, **Tailwind CSS**, and **Shadcn/ui**.

Users upload research papers (PDF, TXT, Markdown, web URL, or ArXiv ID) into isolated sessions, then ask questions about them. The system routes each query intelligently — answering directly from paper content, searching the web for current developments, or verifying whether a claim from a paper has been superseded by newer research.

---

## Target Users

- **Students** reading and trying to understand dense academic papers
- **Researchers** who want to quickly cross-reference claims across multiple papers
- **Literature reviewers** checking whether findings or methods from older papers still hold today
- **Anyone** who wants a conversational interface to a set of documents without manual reading

---

## Features

| Feature | Description |
|---|---|
| **Paper Q&A** | Ask questions about uploaded papers; the system retrieves relevant chunks and generates grounded answers |
| **Claim Verification** | Ask the assistant to verify a claim — it searches the web and ArXiv to determine if the claim is current or superseded, and returns links to newer papers if applicable |
| **Web Search** | For questions about current developments or explicit search requests, live Tavily results are incorporated |
| **Direct Answers** | General knowledge questions are answered without retrieval or web calls |
| **`/btw` Command** | A side-channel for off-topic questions outside the session context. The LLM decides to answer directly or search the web. These exchanges are **not stored in session history** |
| **Multi-session UI** | Open multiple independent sessions simultaneously, each with its own paper collection and conversation history |
| **Auto Session Naming** | Session titles are automatically generated (3–5 words) from the first message using the LLM |
| **Multiple Paper Sources** | Load papers via file upload (PDF, TXT, MD), web URL, or ArXiv ID/title search |
| **Real-time Streaming** | Assistant responses stream token-by-token over Server-Sent Events (SSE) for a snappy user experience |
| **Modern UX** | A sleek React frontend featuring dark mode, floating UI elements, and a responsive sidebar |

---

## How to Use

### 1. Start a session
Launch the app and a default session is created automatically. Use **New Chat** in the sidebar to start additional sessions.

### 2. Upload papers
In the sidebar, choose one of three loading methods under the Documents panel:
- **File Upload** — drag and drop a PDF, TXT, or MD file
- **Web URL** — paste one or more URLs (one per line)
- **ArXiv** — enter a paper title or ArXiv ID (e.g. `2303.08774`)

Loaded papers are listed under "Loaded Documents" in the sidebar.

### 3. Ask questions
Type in the chat input. Example queries:
- *"What methodology does the paper use for evaluation?"*
- *"Verify the claim that encoder-decoder models are the best approach for translation."*
- *"What are the latest developments in diffusion models?"*

### 4. Use `/btw` for off-topic questions
Prefix any message with `/btw` to ask a question outside the current paper context. These exchanges are streamed instantly and are not saved to the session:
```
/btw What is the difference between RLHF and DPO?
```

---

## Installation & Running Locally

Papeer uses a decoupled architecture. You will need two terminal windows.

### 1. Backend (FastAPI)
The backend uses [uv](https://github.com/astral-sh/uv) for dependency management.

```bash
cd rag-backend

# Install dependencies
uv sync

# Copy the example env file and fill in your keys
cp .env.example .env

# Run the FastAPI server (starts on http://localhost:8000)
uv run uvicorn main:app --reload --port 8000
```

### 2. Frontend (React + Vite)
The frontend uses standard `npm`.

```bash
cd frontend

# Install dependencies
npm install

# Run the Vite dev server (starts on http://localhost:5173)
npm run dev
```

Visit `http://localhost:5173` in your browser to use the app!

---

## Required API Keys

All keys are loaded from a `.env` file in the `rag-backend` root directory via `python-dotenv`.

| Variable | Purpose | Where to Get It |
|---|---|---|
| `GOOGLE_API_KEY` | LLM inference (`gemini-3.1-flash-lite`) and embeddings (`models/gemini-embedding-2`) | [aipplatform.google.com](https://aipplatform.google.com) |
| `TAVILY_API_KEY` | Web search for current developments and claim verification | [tavily.com](https://tavily.com) |
| `QDRANT_URL` | Qdrant Cloud endpoint for the vector store | [cloud.qdrant.io](https://cloud.qdrant.io) |
| `QDRANT_API_KEY` | Authentication for Qdrant Cloud | [cloud.qdrant.io](https://cloud.qdrant.io) |

`.env` file format:
```env
GOOGLE_API_KEY=...
TAVILY_API_KEY=tvly-...
QDRANT_URL=https://your-cluster.qdrant.io
QDRANT_API_KEY=your-qdrant-api-key
```

---

## Architecture

```text
rag-backend/ (FastAPI)
├── main.py                  — API entry point and CORS configuration
├── routes/
│   ├── chat.py              — SSE streaming endpoint for RAG chat
│   ├── documents.py         — Endpoints for uploading and listing papers
│   ├── sessions.py          — Endpoints for session metadata and history
│   └── btw.py               — Endpoint for the off-topic side channel
└── backend/
    ├── rag_graph.py         — LangGraph RAG workflow
    ├── btw_handler.py       — Off-topic /btw handler
    ├── vector_store.py      — Qdrant Cloud vector store with cached embeddings
    ├── paper_loader.py      — Multi-source paper loader
    └── models.py            — Pydantic models for routing

frontend/ (React)
├── src/
│   ├── App.tsx              — Main chat UI and sidebar layout
│   ├── api/client.ts        — Frontend API client for talking to FastAPI
│   ├── components/          — UI components (Shadcn/ui, DocumentPanel, etc.)
│   └── index.css            — Tailwind styles and theme tokens
```

### RAG Graph Decision Flow

```text
User Query
    │
    ▼
 Router (LLM)
    │
    ├── direct_answer ──────────────────────────► Generate Answer
    │
    ├── retrieve ──► Agent (retriever + web tools) ──► Relevancy Check
    │                        │                              │
    │                        │◄── Query Rewrite (max 3) ────┘
    │                        └──────────────────────────────► Generate Answer
    │
    └── verify_claim ──► Web Search + ArXiv Search ──► Verdict + Paper Links
```

---

## How the Project Is Production Optimized

| Optimization | Details |
|---|---|
| **Embedding cache** | `CacheBackedEmbeddings` writes to `./embedding_cache/` so identical text is never re-embedded across sessions — reduces OpenAI API calls and latency |
| **Session isolation** | Each session gets its own Qdrant collection (`papeer_{session_id}`) and a separate LangGraph SQLite checkpointer thread — prevents cross-session data leakage |
| **FastAPI Streaming** | The `StreamingResponse` returns LangGraph events over SSE, parsed by a custom `ReadableStream` reader in React for a flawless token-by-token experience |
| **Decoupled Architecture** | Breaking out of Streamlit into FastAPI + React allows for custom routing, complex UI components, and infinite styling flexibility |
| **Session persistence** | `sessions.json` persists session metadata; SQLite stores full conversation state — refreshing the React app restores the previous session seamlessly |
| **Temp file cleanup** | Uploaded files are written to a temp path, processed, then deleted regardless of success or failure |
| **ArXiv reliability** | Claim verification uses two targeted Tavily searches (general web + `site:arxiv.org`) instead of the `arxiv` Python library, which had reliability issues |

---

## Constraints and Why

| Constraint | Why |
|---|---|
| **Max 3 query rewrites** | The RAG graph caps query rewrites at 3 retries before falling back to a plain LLM answer. Without this cap, ambiguous or unanswerable queries would loop indefinitely, burning API tokens and blocking the user |
| **Chunk size 1000 / overlap 200** | Balances retrieval precision (smaller = more focused) against context preservation across chunk boundaries. The 200-char overlap ensures sentences split across chunks are still retrievable |
| **Tavily max 3 results for `/btw`** | Keeps the context window manageable for side-channel queries that are intentionally lightweight and unsaved |
| **`/btw` exchanges not stored** | These are deliberately out-of-context questions. Storing them would pollute session history and confuse the LLM's understanding of the paper-focused conversation |
| **Session-scoped Qdrant collections** | Prevents papers from one session leaking into another. Each collection is namespaced by session UUID |
| **Claim verification uses two searches** | A general web search catches blog posts and news; an `arxiv.org`-targeted search catches academic superseding work. One search alone misses one of these two important source types |
| **`k=4` default retrieval chunks** | Balances context richness against prompt length. Too few chunks miss relevant content; too many dilute focus and increase cost |