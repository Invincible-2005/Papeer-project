/**
 * API Client
 * 
 * In production (Vercel), set the VITE_API_URL environment variable to your
 * Render backend URL, e.g. https://papeer-backend.onrender.com
 * Locally, this defaults to '' so relative /api/ paths work via Vite proxy.
 */

// build: force-refresh
const API_BASE = import.meta.env.VITE_API_URL ?? '';

export const checkHealth = async () => {
  try {
    const response = await fetch(`${API_BASE}/api/health`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error("Health check failed:", error);
    throw error;
  }
};

export const sendChatMessage = async (message: string, sessionId: string) => {
  try {
    const response = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message, session_id: sessionId }),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error("Chat message failed:", error);
    throw error;
  }
};

// ── Session Management ────────────────────────────────────────────────────────

export type SessionMeta = {
  id: string;
  name: string;
  created_at: string;
  is_named: boolean;
}

export const getSessions = async (): Promise<SessionMeta[]> => {
  const response = await fetch(`${API_BASE}/api/sessions`);
  if (!response.ok) throw new Error("Failed to fetch sessions");
  return response.json();
};

export const createSession = async (): Promise<{ session_id: string }> => {
  const response = await fetch(`${API_BASE}/api/sessions`, { method: 'POST' });
  if (!response.ok) throw new Error("Failed to create session");
  return response.json();
};

export const getSessionMessages = async (sessionId: string) => {
  const response = await fetch(`${API_BASE}/api/sessions/${sessionId}/messages`);
  if (!response.ok) throw new Error("Failed to fetch messages");
  return response.json();
};

export const renameSession = async (sessionId: string, firstMessage: string): Promise<{ name: string }> => {
  const response = await fetch(`${API_BASE}/api/sessions/${sessionId}/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ first_message: firstMessage })
  });
  if (!response.ok) throw new Error("Failed to rename session");
  return response.json();
};

export const streamChatMessage = async (
  message: string, 
  sessionId: string, 
  onChunk: (chunk: string) => void,
  onDone: () => void,
  onError: (err: any) => void
) => {
  try {
    const response = await fetch(`${API_BASE}/api/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, session_id: sessionId }),
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    if (!response.body) throw new Error("No response body");

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || ""; // Keep incomplete chunk in buffer

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const dataStr = line.slice(6);
          if (!dataStr.trim()) continue;
          
          try {
            const data = JSON.parse(dataStr);
            if (data.status === 'done') {
              onDone();
              return;
            } else if (data.error) {
              onError(new Error(data.error));
              return;
            } else if (data.chunk) {
              onChunk(data.chunk);
            }
          } catch (e) {
            console.error("Error parsing stream chunk:", e, "String was:", dataStr);
          }
        }
      }
    }
    // Fallback if loop exits without seeing 'done'
    onDone();
  } catch (error) {
    onError(error);
  }
};

export const streamBtwMessage = async (
  query: string,
  onChunk: (chunk: string) => void,
  onDone: () => void,
  onError: (err: any) => void
) => {
  try {
    const response = await fetch(`${API_BASE}/api/btw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    if (!response.body) throw new Error("No response body");

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const dataStr = line.slice(6);
          if (!dataStr.trim()) continue;
          try {
            const data = JSON.parse(dataStr);
            if (data.status === 'done') {
              onDone();
              return;
            } else if (data.error) {
              onError(new Error(data.error));
              return;
            } else if (data.chunk) {
              onChunk(data.chunk);
            }
          } catch (e) {
            console.error("Error parsing stream chunk:", e);
          }
        }
      }
    }
    onDone();
  } catch (error) {
    onError(error);
  }
};

// ── Document Management ───────────────────────────────────────────────────────

export type DocumentInfo = {
  title: string;
}

export type LoadResponse = {
  message: string;
  title: string;
  chunk_count: number;
}

export const getDocuments = async (sessionId: string): Promise<DocumentInfo[]> => {
  const response = await fetch(`${API_BASE}/api/documents/${sessionId}`);
  if (!response.ok) throw new Error("Failed to fetch documents");
  return response.json();
};

export const uploadFile = async (file: File, sessionId: string): Promise<LoadResponse> => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('session_id', sessionId);

  const response = await fetch(`${API_BASE}/api/documents/upload`, {
    method: 'POST',
    body: formData,  // No Content-Type header — browser sets it with boundary
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: "Upload failed" }));
    throw new Error(err.detail || "Upload failed");
  }
  return response.json();
};

export const loadUrl = async (url: string, sessionId: string): Promise<LoadResponse> => {
  const response = await fetch(`${API_BASE}/api/documents/url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, session_id: sessionId }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: "URL load failed" }));
    throw new Error(err.detail || "URL load failed");
  }
  return response.json();
};

export const loadArxiv = async (query: string, sessionId: string): Promise<LoadResponse> => {
  const response = await fetch(`${API_BASE}/api/documents/arxiv`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, session_id: sessionId }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: "ArXiv load failed" }));
    throw new Error(err.detail || "ArXiv load failed");
  }
  return response.json();
};
