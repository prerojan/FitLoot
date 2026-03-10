// ====================================
// src/react-app/pages/AIChat.tsx
// Componente de Chatbot com IA
// ====================================

import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/react-app/contexts/auth";
import BottomNav from "@/react-app/components/BottomNav";
import { Send, Bot, User, Sparkles } from "lucide-react";
import { api } from "@/react-app/utils/api";
import LoadingBall from "@/react-app/components/LoadingBall";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

function parseAIResponse(text: string): string {
  if (!text) return "";

  const lines = text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/^\s*#{1,6}\s*/gm, "")
    .split("\n");

  const normalized = lines
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return "";

      if (/^\|?\s*-{3,}/.test(trimmed) || /^\|[-\s:|]+\|$/.test(trimmed)) {
        return "";
      }

      if (trimmed.startsWith("|")) {
        return trimmed
          .split("|")
          .map((chunk) => chunk.trim())
          .filter(Boolean)
          .join(" • ");
      }

      if (/^[-*]\s+/.test(trimmed)) {
        return `• ${trimmed.replace(/^[-*]\s+/, "")}`;
      }

      return line;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return normalized;
}

export default function AIChat() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "Olá! Sou o FitBot. Como posso te ajudar hoje?",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionMessageCount, setSessionMessageCount] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) {
      navigate("/app");
      return;
    }
  }, [user, navigate]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage: Message = {
      role: "user",
      content: input,
      timestamp: new Date(),
    };

    const nextSessionCount = sessionMessageCount + 1;
    setSessionMessageCount(nextSessionCount);
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    try {
      // Build conversation history for context
      const history = messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      const response = await api("/api/ai/chat", {
        method: "POST",
        body: JSON.stringify({
          message: input,
          history,
          session_count: nextSessionCount,
        }),
      });

      if (response.status === 401 || response.status === 403) {
        navigate("/app");
        return;
      }

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string | undefined } | null;
        throw new Error(payload?.error || "Failed to get response");
      }

      const data = await response.json();

      const assistantMessage: Message = {
        role: "assistant",
        content: parseAIResponse(String(data.message || "")),
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      console.error("Chat error:", error);
      const errorMessage: Message = {
        role: "assistant",
        content: "Desculpe, tive um problema ao processar sua mensagem. Tente novamente!",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  const quickQuestions = [
    "Como fazer flexões corretamente?",
    "Qual treino para perder peso?",
    "Dicas para manter motivação",
    "Como aumentar força?",
  ];

  const handleQuickQuestion = (question: string) => {
    setInput(question);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 pb-24">
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white px-6 py-6 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="bg-white/20 backdrop-blur-sm p-3 rounded-full">
            <Bot className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">FitBot</h1>
            <p className="text-emerald-100 text-sm flex items-center gap-1">
              <Sparkles className="w-3 h-3" />
              Assistente Fitness com IA
            </p>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="px-4 py-6 space-y-4 max-h-[calc(100vh-280px)] overflow-y-auto">
        {messages.map((message, index) => (
          <div
            key={index}
            className={`flex gap-3 ${
              message.role === "user" ? "flex-row-reverse" : "flex-row"
            }`}
          >
            <div
              className={`shrink-0 self-start p-2 rounded-full ${
                message.role === "user"
                  ? "bg-emerald-500"
                  : "bg-white shadow-md"
              }`}
            >
              {message.role === "user" ? (
                <User className="w-5 h-5 text-white" />
              ) : (
                <Bot className="w-5 h-5 text-emerald-600" />
              )}
            </div>
            <div
              className={`max-w-[75%] p-4 rounded-2xl ${
                message.role === "user"
                  ? "bg-emerald-500 text-white rounded-tr-none"
                  : "bg-white shadow-md rounded-tl-none"
              }`}
            >
              <p className="text-sm whitespace-pre-wrap">{message.content}</p>
              <p
                className={`text-xs mt-2 ${
                  message.role === "user" ? "text-emerald-100" : "text-gray-400"
                }`}
              >
                {message.timestamp.toLocaleTimeString("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex gap-3">
            <div className="shrink-0 self-start p-2 rounded-full bg-white shadow-md">
              <Bot className="w-5 h-5 text-emerald-600" />
            </div>
            <div className="bg-white shadow-md p-4 rounded-2xl rounded-tl-none">
              <LoadingBall size="md" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick Questions */}
      {messages.length <= 1 && !loading && (
        <div className="px-4 mb-4">
          <p className="text-xs text-gray-500 mb-2">Perguntas rápidas:</p>
          <div className="flex flex-wrap gap-2">
            {quickQuestions.map((question, index) => (
              <button
                key={index}
                onClick={() => handleQuickQuestion(question)}
                className="px-3 py-2 bg-white rounded-full text-xs text-gray-700 shadow-sm hover:shadow-md transition-shadow"
              >
                {question}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="fixed bottom-20 left-0 right-0 px-4 pb-4 bg-gradient-to-t from-white to-transparent pt-4">
        <form onSubmit={sendMessage} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Digite sua pergunta..."
            className="flex-1 px-4 py-3 rounded-full border-2 border-emerald-200 focus:border-emerald-500 outline-none bg-white shadow-sm"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="shrink-0 w-10 h-10 bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-full shadow-lg hover:shadow-xl transition-shadow disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
          >
            <Send className="w-5 h-5" />
          </button>
        </form>
      </div>

      <BottomNav active="profile" />
    </div>
  );
}
