import React, { useState, useEffect, useRef } from 'react'
import { Plus, MessageSquare, Menu, Send, Loader2, ArrowDown } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from "@/components/ui/sheet"

import { ModeToggle } from '@/components/theme-toggle'
import { DocumentPanel } from '@/components/document-panel'
import {
  checkHealth,
  streamChatMessage,
  streamBtwMessage,
  getSessions,
  createSession,
  getSessionMessages,
  renameSession,
  SessionMeta
} from './api/client'

type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
  isBtw?: boolean
}

const SidebarContent = ({ 
  sessions, 
  currentSessionId, 
  handleNewSession, 
  handleSelectSession 
}: {
  sessions: SessionMeta[],
  currentSessionId: string | null,
  handleNewSession: () => void,
  handleSelectSession: (id: string) => void
}) => (
  <div className="flex flex-col h-full gap-4 overflow-y-auto">
    <Button onClick={handleNewSession} className="w-full flex items-center gap-2 shrink-0" variant="default">
      <Plus size={18} /> New Chat
    </Button>

    <div className="pr-2 space-y-2">
      {sessions.length === 0 && (
        <p className="text-sm text-muted-foreground text-center mt-4">No sessions yet.</p>
      )}
      {sessions.map(s => (
        <Button
          key={s.id}
          variant={currentSessionId === s.id ? "secondary" : "ghost"}
          className="w-full justify-start text-left truncate"
          onClick={() => handleSelectSession(s.id)}
        >
          <MessageSquare size={16} className="mr-2 shrink-0" />
          <span className="truncate">{s.name}</span>
        </Button>
      ))}
    </div>

    {/* Document Panel */}
    <DocumentPanel sessionId={currentSessionId} />
  </div>
);

function App() {
  const [health, setHealth] = useState(false);

  // State: Sessions
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  // State: Chat
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  };

  // 1. Initial Load
  useEffect(() => {
    const initApp = async () => {
      try {
        await checkHealth();
        setHealth(true);
        await loadSessions();
      } catch (error) {
        console.error("Backend not reachable", error);
      }
    };
    initApp();
  }, []);

  // 2. Load sessions
  const loadSessions = async (autoSelectId?: string) => {
    try {
      const data = await getSessions();
      setSessions(data);
      if (data.length > 0) {
        if (autoSelectId) {
          handleSelectSession(autoSelectId);
        } else if (!currentSessionId) {
          handleSelectSession(data[0].id);
        }
      }
    } catch (error) {
      console.error("Failed to load sessions", error);
    }
  };

  // 3. Select a session
  const handleSelectSession = async (id: string) => {
    if (id === currentSessionId) {
      scrollToBottom();
      return;
    }
    
    setCurrentSessionId(id);
    setIsLoadingMessages(true);
    setMessages([]);
    try {
      const msgs = await getSessionMessages(id);
      setMessages(msgs);
    } catch (error) {
      console.error("Failed to load messages", error);
    } finally {
      setIsLoadingMessages(false);
    }
  };

  // 4. Create new session
  const handleNewSession = async () => {
    try {
      const { session_id } = await createSession();
      await loadSessions(session_id);
    } catch (error) {
      console.error("Failed to create session", error);
    }
  };

  // 5. Send message (Streaming)
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputMessage.trim() || !currentSessionId || isSending) return;

    const userMessage = inputMessage;
    setInputMessage('');
    
    const isBtw = userMessage.trim().toLowerCase().startsWith('/btw');
    const btwQuery = isBtw ? userMessage.trim().substring(4).trim() : '';

    if (isBtw && !btwQuery) {
      setMessages(prev => [
        ...prev, 
        { role: 'user', content: userMessage, isBtw: true },
        { role: 'assistant', content: "Please add a question after `/btw`, e.g. `/btw What is attention?`", isBtw: true }
      ]);
      return;
    }

    // Add user message AND an empty placeholder for the assistant's streaming response
    setMessages(prev => [
      ...prev, 
      { role: 'user', content: userMessage, isBtw },
      { role: 'assistant', content: "", isBtw }
    ]);
    setIsSending(true);

    if (isBtw) {
      // Handle side-channel (no state saved on backend)
      streamBtwMessage(
        btwQuery,
        (chunk) => {
          setMessages(prev => {
            const newMessages = [...prev];
            const lastMsg = newMessages[newMessages.length - 1];
            if (lastMsg.role === 'assistant') {
              lastMsg.content += chunk;
            }
            return newMessages;
          });
        },
        () => setIsSending(false),
        (error) => {
          console.error("BTW Stream error:", error);
          setMessages(prev => {
            const newMessages = [...prev];
            const lastMsg = newMessages[newMessages.length - 1];
            if (lastMsg.role === 'assistant' && !lastMsg.content) {
              lastMsg.content = "❌ Error connecting to backend.";
            }
            return newMessages;
          });
          setIsSending(false);
        }
      );
      return;
    }

    // Standard RAG streaming
    streamChatMessage(
      userMessage,
      currentSessionId,
      (chunk) => {
        // onChunk: append the new text chunk to the very last message in the array
        setMessages(prev => {
          const newMessages = [...prev];
          const lastMsg = newMessages[newMessages.length - 1];
          if (lastMsg.role === 'assistant') {
            lastMsg.content += chunk;
          }
          return newMessages;
        });
      },
      () => {
        // onDone
        setIsSending(false);
        // If it was an unnamed session, reload to get the new LLM-generated name
        const currentSess = sessions.find(s => s.id === currentSessionId);
        if (currentSess && !currentSess.is_named) {
          renameSession(currentSessionId, userMessage)
            .then(() => getSessions())
            .then(setSessions)
            .catch(err => console.error("Failed to rename session:", err));
        }
      },
      (error) => {
        // onError
        console.error("Stream error:", error);
        setMessages(prev => {
          const newMessages = [...prev];
          const lastMsg = newMessages[newMessages.length - 1];
          if (lastMsg.role === 'assistant' && !lastMsg.content) {
            lastMsg.content = "❌ Error connecting to backend.";
          }
          return newMessages;
        });
        setIsSending(false);
      }
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Auto-scroll to bottom of chat when new messages arrive
  useEffect(() => {
    scrollToBottom();
  }, [messages, isSending, currentSessionId]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    const distanceToBottom = scrollHeight - scrollTop - clientHeight;
    setShowScrollButton(distanceToBottom > 150);
  };

  const isBtwInput = inputMessage.trim().toLowerCase().startsWith('/btw');

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">

      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex w-72 flex-col border-r bg-muted/30 p-4 shrink-0">
        <div className="flex items-center justify-between mb-6 px-2">
          <h1 className="font-bold text-xl tracking-tight">Papeer UI</h1>
          {health ? (
            <div className="w-2 h-2 rounded-full bg-green-500" title="Connected to Backend" />
          ) : (
            <div className="w-2 h-2 rounded-full bg-red-500" title="Disconnected" />
          )}
        </div>
        <SidebarContent 
          sessions={sessions}
          currentSessionId={currentSessionId}
          handleNewSession={handleNewSession}
          handleSelectSession={handleSelectSession}
        />
      </aside>

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col h-full relative min-w-0">

        {/* Top Navbar */}
        <header className="h-14 border-b bg-background flex items-center justify-between px-4 lg:justify-end shrink-0">
          <div className="lg:hidden flex items-center gap-2">
            <Sheet>
              <SheetTrigger render={<Button variant="ghost" size="icon" />}>
                <Menu size={20} />
              </SheetTrigger>
              <SheetContent side="left" className="w-72">
                <SheetHeader className="mb-6 text-left">
                  <SheetTitle>Papeer UI</SheetTitle>
                </SheetHeader>
                <SidebarContent 
                  sessions={sessions}
                  currentSessionId={currentSessionId}
                  handleNewSession={handleNewSession}
                  handleSelectSession={handleSelectSession}
                />
              </SheetContent>
            </Sheet>
            <span className="font-semibold">Papeer</span>
          </div>

          <ModeToggle />
        </header>

        {/* Chat Messages */}
        <div className="flex-1 overflow-y-auto p-4 lg:p-8" onScroll={handleScroll}>
          <div className="max-w-3xl mx-auto space-y-6 pb-4">
            {!currentSessionId ? (
              <div className="text-center text-muted-foreground mt-20">
                <MessageSquare className="mx-auto h-12 w-12 opacity-20 mb-4" />
                <p>Select or start a new chat to begin.</p>
              </div>
            ) : isLoadingMessages ? (
              <div className="flex justify-center mt-20">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : messages.length === 0 ? (
              <div className="text-center text-muted-foreground mt-20">
                <p>This is the start of your conversation.</p>
              </div>
            ) : (
              messages.map((m, idx) => (
                <div key={idx} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`px-5 py-4 rounded-2xl max-w-[85%] ${m.role === 'user'
                    ? 'bg-primary text-primary-foreground rounded-tr-sm'
                    : 'bg-muted rounded-tl-sm'
                    }`}>
                    <div className="prose dark:prose-invert max-w-none whitespace-pre-wrap leading-relaxed">
                      {m.content}
                    </div>
                    {m.isBtw && (
                      <p className="text-[10px] uppercase tracking-wider opacity-60 mt-2 font-semibold">
                        Side channel — not saved to history
                      </p>
                    )}
                  </div>
                </div>
              ))
            )}

            {isSending && (
              <div className="flex justify-start">
                <div className="px-5 py-4 rounded-2xl bg-muted rounded-tl-sm max-w-[85%]">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              </div>
            )}
            <div ref={scrollRef} />
          </div>
        </div>

        {/* Floating Scroll to Bottom Button */}
        {showScrollButton && (
          <div className="absolute bottom-28 right-8 z-10">
            <Button
              variant="secondary"
              size="icon"
              className="rounded-full shadow-md h-10 w-10 border bg-background/95 backdrop-blur"
              onClick={scrollToBottom}
            >
              <ArrowDown size={18} />
            </Button>
          </div>
        )}

        {/* Input Area */}
        <div className="shrink-0 p-4 bg-background">
          <div className="max-w-3xl mx-auto">
            <form
              onSubmit={handleSendMessage}
              className={`relative flex items-end bg-background border shadow-sm rounded-2xl p-2 transition-all ${
                isBtwInput ? 'border-indigo-500/50 ring-1 ring-indigo-500/30' : ''
              }`}
            >
              {isBtwInput && (
                <div className="absolute -top-6 left-4 bg-indigo-500 text-white text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-md shadow-sm">
                  Side Channel Mode
                </div>
              )}
              <Textarea
                value={inputMessage}
                onChange={e => setInputMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask Papeer anything... (Shift+Enter for new line)"
                className="border-0 focus-visible:ring-0 focus-visible:ring-offset-0 shadow-none px-4 py-3 min-h-15 max-h-50 resize-none"
                disabled={!currentSessionId || isSending || !health}
                rows={1}
              />
              <Button
                type="submit"
                size="icon"
                className="rounded-full shrink-0 mb-1 mr-1 h-10 w-10"
                disabled={!inputMessage.trim() || !currentSessionId || isSending || !health}
              >
                <Send size={18} />
              </Button>
            </form>
            <p className="text-center text-xs text-muted-foreground mt-3">
              Papeer may make mistakes. Verify important information.
            </p>
          </div>
        </div>

      </main>
    </div>
  )
}

export default App
