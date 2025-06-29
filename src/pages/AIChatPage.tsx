import React, { useState, useEffect, useRef } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { Document, Page, pdfjs } from "react-pdf";
import { GoogleGenerativeAI } from "@google/generative-ai";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronLeft, Send, Loader2, User, Bot } from "lucide-react";
import { toast } from "@/components/ui/use-toast";
import { getTextDirection } from "@/lib/textDirection";
import SwitchModeButton from "@/components/SwitchModeButton";
import type { RegionData, WorksheetMetadata } from "@/types/worksheet";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const AIChatPage: React.FC = () => {
  const { worksheetId, pageNumber } = useParams<{ worksheetId: string; pageNumber: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  
  // Get the state passed during navigation
  const locationState = location.state as { 
    fromTextMode?: boolean;
    activeRegion?: RegionData;
    currentStepIndex?: number;
    pdfUrl?: string;
    worksheetMeta?: WorksheetMetadata;
  } | null;
  
  const fromTextMode = locationState?.fromTextMode || false;
  const activeRegion = locationState?.activeRegion;
  const currentStepIndex = locationState?.currentStepIndex || 0;
  const pdfUrl = locationState?.pdfUrl;
  const worksheetMeta = locationState?.worksheetMeta;
  
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [pageImage, setPageImage] = useState<string | null>(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState(true);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load chat history from localStorage on component mount or when worksheet/page changes
  useEffect(() => {
    if (!worksheetId || !pageNumber) return;
    
    // DEBUG: Check session state when AIChatPage mounts
    const sessionKey = `worksheet_page_state_${worksheetId}_${pageNumber}`;
    const currentSessionState = sessionStorage.getItem(sessionKey);
    console.log('🔍 [DEBUG] AIChatPage - Session state ON MOUNT:', {
      sessionKey,
      currentSessionState,
      parsedState: currentSessionState ? JSON.parse(currentSessionState) : null
    });
    
    const chatHistoryKey = `aiChatHistory_${worksheetId}_${pageNumber}`;
    
    try {
      const storedHistory = localStorage.getItem(chatHistoryKey);
      if (storedHistory) {
        const parsedHistory = JSON.parse(storedHistory);
        if (Array.isArray(parsedHistory) && parsedHistory.length > 0) {
          setMessages(parsedHistory);
          return; // Don't set default message if we have stored history
        }
      }
    } catch (error) {
      // Suppress non-debug logs
    }
    
    // Set default AI welcome message if no stored history
    setMessages([{
      role: 'assistant',
      content: `How can I help you with this worksheet page?`
    }]);
  }, [worksheetId, pageNumber]);

  // Save chat history to localStorage whenever messages change
  useEffect(() => {
    if (!worksheetId || !pageNumber || messages.length === 0) return;
    
    const chatHistoryKey = `aiChatHistory_${worksheetId}_${pageNumber}`;
    
    try {
      localStorage.setItem(chatHistoryKey, JSON.stringify(messages));
    } catch (error) {
      // Suppress non-debug logs
    }
  }, [messages, worksheetId, pageNumber]);

  // Scroll to bottom when new messages are added - changed from "smooth" to "instant"
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
  }, [messages]);

  // Load cached page image or generate new one
  useEffect(() => {
    if (!pdfUrl || !pageNumber || !worksheetId) {
      setIsGeneratingImage(false);
      toast({
        title: "Error",
        description: "PDF data not available for AI chat.",
        variant: "destructive"
      });
      return;
    }
    
    // Create a unique key for this worksheet page image
    const imageKey = `worksheetPageImage_${worksheetId}_${pageNumber}`;
    
    // Try to load cached image from sessionStorage first
    try {
      const cachedImage = sessionStorage.getItem(imageKey);
      if (cachedImage) {
        setPageImage(cachedImage);
        setIsGeneratingImage(false);
        return;
      }
    } catch (error) {
      // Suppress non-debug logs
    }
    
    // If no cached image found, generate a new one
    setIsGeneratingImage(true);
  }, [pdfUrl, pageNumber, worksheetId]);

  const onPageLoadSuccess = (page: any) => {
    const canvas = canvasRef.current;
    if (!canvas || !worksheetId || !pageNumber) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    // Set canvas size to match PDF page
    const viewport = page.getViewport({ scale: 1.5 });
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    // Render PDF page to canvas
    const renderContext = {
      canvasContext: context,
      viewport: viewport,
    };

    page.render(renderContext).promise.then(() => {
      // Convert canvas to base64 image
      const imageDataUrl = canvas.toDataURL('image/png');
      setPageImage(imageDataUrl);
      setIsGeneratingImage(false);
      
      // Cache the generated image in sessionStorage for future use
      const imageKey = `worksheetPageImage_${worksheetId}_${pageNumber}`;
      try {
        sessionStorage.setItem(imageKey, imageDataUrl);
      } catch (error) {
        // If sessionStorage is full, try to clear old worksheet images
        try {
          // Clear old worksheet page images to make space
          for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            if (key && key.startsWith('worksheetPageImage_') && key !== imageKey) {
              sessionStorage.removeItem(key);
            }
          }
          // Try to save again after cleanup
          sessionStorage.setItem(imageKey, imageDataUrl);
        } catch (cleanupError) {
          // Suppress non-debug logs
        }
      }
    }).catch((error: any) => {
      setIsGeneratingImage(false);
      toast({
        title: "Error",
        description: "Failed to generate page image for AI analysis.",
        variant: "destructive"
      });
    });
  };

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || isLoading || !pageImage) return;

    const apiKey = localStorage.getItem('gemini-api-key');
    if (!apiKey) {
      toast({
        title: "API Key Missing",
        description: "Please set your Gemini API key first.",
        variant: "destructive"
      });
      return;
    }

    const userMessage = inputMessage.trim();
    setInputMessage("");
    setIsLoading(true);

    // Add user message to chat
    const newMessages: ChatMessage[] = [...messages, { role: 'user', content: userMessage }];
    setMessages(newMessages);

    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

      // Prepare the conversation history for context
      const conversationHistory = newMessages
        .filter(msg => msg.role === 'user')
        .map(msg => `User: ${msg.content}`)
        .join('\n');

      // Create the prompt with enhanced instructions for distinguishing question types
      const prompt = `Act as a tutor. You must distinguish between two types of student questions:

1. WORKSHEET QUESTIONS: Questions asking for direct answers to specific worksheet problems, exercises, or tasks shown in the image.
   - For these questions: NEVER give the direct answer. Instead, provide hints, guide the student's thinking process, ask leading questions, or explain the underlying concepts that will help them solve it themselves.
   - Examples: "What's the answer to question 3?", "Fill in the blank for me", "What should I write here?", "What's the correct word?"

2. CONCEPTUAL QUESTIONS: Questions asking for understanding of general concepts, explanations, or clarification that are NOT asking for specific worksheet answers.
   - For these questions: Provide clear, direct explanations and help the student understand the concept fully.
   - Examples: "What is an adjective?", "How do I identify weather patterns?", "Can you explain what this concept means?", "Why does this work this way?"

IMPORTANT: Always respond in the same language as the worksheet content and the user's question.

Previous conversation:
${conversationHistory}

Current question: ${userMessage}

Analyze the student's question carefully. If they're asking for a specific worksheet answer, guide them without giving the answer. If they're asking to understand a concept, explain it clearly and directly. Be encouraging and educational in both cases.`;

      // Convert base64 image to the format expected by Gemini
      const base64Data = pageImage.split(',')[1]; // Remove data:image/png;base64, prefix
      
      const imagePart = {
        inlineData: {
          data: base64Data,
          mimeType: "image/png"
        }
      };

      const result = await model.generateContent([prompt, imagePart]);
      const response = await result.response;
      const aiResponse = response.text();

      // Add AI response to chat
      setMessages(prev => [...prev, { role: 'assistant', content: aiResponse }]);

      // DEBUG: Check session state after AI response
      const sessionKey = `worksheet_page_state_${worksheetId}_${pageNumber}`;
      const currentSessionState = sessionStorage.getItem(sessionKey);
      console.log('🔍 [DEBUG] AIChatPage - Session state AFTER AI response:', {
        sessionKey,
        currentSessionState,
        parsedState: currentSessionState ? JSON.parse(currentSessionState) : null
      });

    } catch (error) {
      toast({
        title: "AI Error",
        description: "Failed to get response from AI. Please check your API key and try again.",
        variant: "destructive"
      });
      
      // Remove the user message if AI failed to respond
      setMessages(messages);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const goBack = () => {
    // DEBUG: Check session state before navigating back to worksheet
    const sessionKey = `worksheet_page_state_${worksheetId}_${pageNumber}`;
    const currentSessionState = sessionStorage.getItem(sessionKey);
    console.log('🔍 [DEBUG] AIChatPage - Session state BEFORE navigating back to worksheet:', {
      sessionKey,
      currentSessionState,
      parsedState: currentSessionState ? JSON.parse(currentSessionState) : null
    });
    
    // Navigate back to worksheet without any state - this will show the main PDF view
    navigate(`/worksheet/${worksheetId}/${pageNumber}`);
  };

  if (!worksheetId || !pageNumber) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center">
        <h1 className="text-2xl font-bold text-red-500 mb-4">
          Missing worksheet information
        </h1>
        <Button onClick={() => navigate("/")} className="bg-gradient-orange-magenta hover:bg-gradient-orange-magenta text-white">
          Return to Scanner
        </Button>
      </div>
    );
  }

  if (!pdfUrl) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center">
        <h1 className="text-2xl font-bold text-red-500 mb-4">
          Worksheet data not available
        </h1>
        <Button onClick={goBack} className="bg-gradient-orange-magenta hover:bg-gradient-orange-magenta text-white">
          Return to Worksheet
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Fixed Back Button */}
      <Button
        onClick={goBack}
        className="fixed top-4 left-4 z-70 rounded-full bg-gradient-orange-magenta hover:bg-gradient-orange-magenta text-white shadow-lg"
        size="icon"
      >
        <ChevronLeft className="h-5 w-5" />
      </Button>

      {/* Fixed Header */}
      <div className="fixed top-0 left-0 right-0 z-60 bg-white border-b border-gray-200 p-4 flex items-center gap-4">
        <div className="flex-1 text-center">
          <h1 className="text-xl font-semibold">AI Chat</h1>
        </div>
      </div>

      {/* Main Chat Container */}
      <div className="flex-1 flex flex-col pt-20 pb-20 max-w-4xl mx-auto w-full">
        {/* Messages Container */}
        <div className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="space-y-4 p-4">
              {messages.map((message, index) => (
                <div
                  key={index}
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {message.role === 'user' ? (
                    // User message - gradient orange-magenta bubble on the right
                    <div 
                      className="max-w-[80%] bg-gradient-orange-magenta text-white rounded-2xl px-4 py-3 shadow-sm"
                      dir={getTextDirection(message.content)}
                    >
                      <div className="whitespace-pre-wrap break-words">
                        {message.content}
                      </div>
                    </div>
                  ) : (
                    // AI message - full width, no bubble
                    <div className="w-full">
                      <div 
                        className="text-gray-800 leading-relaxed"
                        dir={getTextDirection(message.content)}
                      >
                        <ReactMarkdown 
                          remarkPlugins={[remarkGfm]} 
                          className="prose prose-gray max-w-none prose-headings:text-gray-900 prose-p:text-gray-800 prose-strong:text-gray-900 prose-em:text-gray-800 prose-code:bg-gray-100 prose-code:text-gray-900 prose-pre:bg-gray-100 prose-pre:text-gray-900 prose-li:text-gray-800 prose-a:text-blue-600 prose-blockquote:text-gray-700 prose-blockquote:border-gray-300"
                          components={{
                            p: ({ children }) => <p className="mb-4 last:mb-0">{children}</p>,
                            ul: ({ children }) => <ul className="mb-4 last:mb-0 space-y-1">{children}</ul>,
                            ol: ({ children }) => <ol className="mb-4 last:mb-0 space-y-1">{children}</ol>,
                            li: ({ children }) => <li className="text-gray-800">{children}</li>,
                            h1: ({ children }) => <h1 className="text-xl font-semibold mb-3 text-gray-900">{children}</h1>,
                            h2: ({ children }) => <h2 className="text-lg font-semibold mb-2 text-gray-900">{children}</h2>,
                            h3: ({ children }) => <h3 className="text-base font-semibold mb-2 text-gray-900">{children}</h3>,
                            code: ({ children, className }) => {
                              const isInline = !className;
                              return isInline ? (
                                <code className="bg-gray-100 text-gray-900 px-1 py-0.5 rounded text-sm">{children}</code>
                              ) : (
                                <code className={className}>{children}</code>
                              );
                            },
                            pre: ({ children }) => (
                              <pre className="bg-gray-100 text-gray-900 p-3 rounded-md overflow-x-auto mb-4">{children}</pre>
                            ),
                            blockquote: ({ children }) => (
                              <blockquote className="border-l-4 border-gray-300 pl-4 italic text-gray-700 mb-4">{children}</blockquote>
                            )
                          }}
                        >
                          {message.content}
                        </ReactMarkdown>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              
              {/* Loading indicator */}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-2 text-gray-600 bg-gray-100 rounded-2xl px-4 py-3">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Thinking...</span>
                  </div>
                </div>
              )}
              
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* Fixed Input Area */}
      <div className="fixed bottom-0 left-0 right-0 z-60 bg-white border-t border-gray-200 p-4">
        <div className="max-w-3xl mx-auto">
          <div className="flex gap-3">
            <Input
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Ask about this worksheet page..."
              disabled={isLoading || isGeneratingImage}
              className="flex-1 min-h-[44px] text-base border-gray-300 focus:border-orange-500 focus:ring-orange-500"
              dir={getTextDirection(inputMessage)}
            />
            <Button
              onClick={handleSendMessage}
              disabled={isLoading || !inputMessage.trim() || isGeneratingImage}
              className="bg-gradient-orange-magenta hover:bg-gradient-orange-magenta min-w-[44px] h-[44px] px-3"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Hidden PDF rendering for image generation - only render if no cached image */}
      {!pageImage && (
        <div className="hidden">
          {pdfUrl && (
            <Document file={pdfUrl}>
              <Page
                pageNumber={parseInt(pageNumber)}
                onLoadSuccess={onPageLoadSuccess}
                renderTextLayer={false}
                renderAnnotationLayer={false}
              />
            </Document>
          )}
          <canvas ref={canvasRef} />
        </div>
      )}

      {/* Only render SwitchModeButton if user came from text mode */}
      {fromTextMode && (
        <SwitchModeButton 
          worksheetId={worksheetId!} 
          pageNumber={parseInt(pageNumber!)} 
          shouldDisplay={true}
          initialActiveRegion={activeRegion}
          initialCurrentStepIndex={currentStepIndex}
        />
      )}
    </div>
  );
};

export default AIChatPage;