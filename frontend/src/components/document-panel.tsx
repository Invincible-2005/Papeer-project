import React, { useState, useRef, useEffect } from 'react'
import { Upload, Globe, BookOpen, FileText, Loader2, X, Check } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"

import { 
  uploadFile, 
  loadUrl, 
  loadArxiv, 
  getDocuments, 
  DocumentInfo 
} from '@/api/client'

type DocumentPanelProps = {
  sessionId: string | null;
}

type StatusMessage = {
  type: 'success' | 'error';
  text: string;
}

export function DocumentPanel({ sessionId }: DocumentPanelProps) {
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Form state
  const [urlInput, setUrlInput] = useState('');
  const [arxivInput, setArxivInput] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  // Load documents when session changes
  useEffect(() => {
    if (sessionId) {
      loadDocuments();
    } else {
      setDocuments([]);
    }
  }, [sessionId]);

  // Auto-clear status messages
  useEffect(() => {
    if (status) {
      const timer = setTimeout(() => setStatus(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [status]);

  const loadDocuments = async () => {
    if (!sessionId) return;
    try {
      const docs = await getDocuments(sessionId);
      setDocuments(docs);
    } catch (error) {
      console.error("Failed to load documents:", error);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setSelectedFiles(Array.from(e.target.files));
    }
  };

  const handleUploadFiles = async () => {
    if (!sessionId || selectedFiles.length === 0) return;
    setIsLoading(true);
    setStatus(null);
    
    let successCount = 0;
    for (const file of selectedFiles) {
      try {
        await uploadFile(file, sessionId);
        successCount++;
      } catch (error: any) {
        setStatus({ type: 'error', text: `Failed: ${file.name} — ${error.message}` });
      }
    }

    if (successCount > 0) {
      setStatus({ type: 'success', text: `Added ${successCount} file(s)` });
      setSelectedFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await loadDocuments();
    }
    setIsLoading(false);
  };

  const handleLoadUrl = async () => {
    if (!sessionId || !urlInput.trim()) return;
    setIsLoading(true);
    setStatus(null);

    try {
      const result = await loadUrl(urlInput.trim(), sessionId);
      setStatus({ type: 'success', text: `Loaded: ${result.title}` });
      setUrlInput('');
      await loadDocuments();
    } catch (error: any) {
      setStatus({ type: 'error', text: error.message });
    }
    setIsLoading(false);
  };

  const handleLoadArxiv = async () => {
    if (!sessionId || !arxivInput.trim()) return;
    setIsLoading(true);
    setStatus(null);

    try {
      const result = await loadArxiv(arxivInput.trim(), sessionId);
      setStatus({ type: 'success', text: `Loaded: ${result.title}` });
      setArxivInput('');
      await loadDocuments();
    } catch (error: any) {
      setStatus({ type: 'error', text: error.message });
    }
    setIsLoading(false);
  };

  if (!sessionId) {
    return (
      <div className="p-4 text-sm text-muted-foreground text-center">
        Select a session to manage documents.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Separator />
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider px-2">
        Documents
      </h3>

      {/* Status Message */}
      {status && (
        <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-md ${
          status.type === 'success' 
            ? 'bg-green-500/10 text-green-600 dark:text-green-400' 
            : 'bg-red-500/10 text-red-600 dark:text-red-400'
        }`}>
          {status.type === 'success' ? <Check size={14} /> : <X size={14} />}
          <span className="truncate">{status.text}</span>
        </div>
      )}

      {/* Tabs for different load methods */}
      <Tabs defaultValue="file" className="w-full">
        <TabsList className="grid w-full grid-cols-3 h-8">
          <TabsTrigger value="file" className="text-xs gap-1">
            <Upload size={12} /> File
          </TabsTrigger>
          <TabsTrigger value="url" className="text-xs gap-1">
            <Globe size={12} /> URL
          </TabsTrigger>
          <TabsTrigger value="arxiv" className="text-xs gap-1">
            <BookOpen size={12} /> ArXiv
          </TabsTrigger>
        </TabsList>

        {/* File Upload Tab */}
        <TabsContent value="file" className="space-y-2 mt-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.txt,.md,.markdown"
            multiple
            onChange={handleFileSelect}
            className="text-xs w-full file:mr-2 file:py-1 file:px-2 file:rounded-md file:border-0 file:text-xs file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 cursor-pointer"
          />
          {selectedFiles.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {selectedFiles.map((f, i) => (
                <Badge key={i} variant="secondary" className="text-xs">{f.name}</Badge>
              ))}
            </div>
          )}
          <Button 
            size="sm" 
            className="w-full" 
            onClick={handleUploadFiles} 
            disabled={isLoading || selectedFiles.length === 0}
          >
            {isLoading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Upload size={14} className="mr-1" />}
            Add Files
          </Button>
        </TabsContent>

        {/* URL Tab */}
        <TabsContent value="url" className="space-y-2 mt-2">
          <Input
            placeholder="https://example.com/paper"
            value={urlInput}
            onChange={e => setUrlInput(e.target.value)}
            className="h-8 text-xs"
            onKeyDown={e => e.key === 'Enter' && handleLoadUrl()}
          />
          <Button 
            size="sm" 
            className="w-full" 
            onClick={handleLoadUrl} 
            disabled={isLoading || !urlInput.trim()}
          >
            {isLoading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Globe size={14} className="mr-1" />}
            Load URL
          </Button>
        </TabsContent>

        {/* ArXiv Tab */}
        <TabsContent value="arxiv" className="space-y-2 mt-2">
          <Input
            placeholder="1706.03762 or Attention Is All You Need"
            value={arxivInput}
            onChange={e => setArxivInput(e.target.value)}
            className="h-8 text-xs"
            onKeyDown={e => e.key === 'Enter' && handleLoadArxiv()}
          />
          <Button 
            size="sm" 
            className="w-full" 
            onClick={handleLoadArxiv} 
            disabled={isLoading || !arxivInput.trim()}
          >
            {isLoading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <BookOpen size={14} className="mr-1" />}
            Load ArXiv Paper
          </Button>
        </TabsContent>
      </Tabs>

      {/* Loaded Documents List */}
      <Separator />
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2">
        Loaded Documents ({documents.length})
      </h4>
      <div className="space-y-1 px-1">
        {documents.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-2">
            No documents loaded yet.
          </p>
        ) : (
          documents.map((doc, idx) => (
            <div key={idx} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/50 transition-colors">
              <FileText size={14} className="shrink-0 text-muted-foreground" />
              <span className="text-xs truncate">{doc.title}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
