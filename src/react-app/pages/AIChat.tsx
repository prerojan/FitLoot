// ====================================
// src/react-app/pages/AIChat.tsx
// Componente de Chatbot com IA
// ====================================

import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/react-app/contexts/auth";
import AppPageShell from "@/react-app/components/AppPageShell";
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
    <AppPageShell bottomNavActive="missions" className="bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50">
      <section className="fl-app-container pt-4 md:pt-8">
        <div className="rounded-[1.75rem] bg-gradient-to-r from-emerald-500 to-teal-600 px-4 py-5 text-white shadow-xl sm:px-6 sm:py-6">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-white/20 p-3 backdrop-blur-sm">
              <Bot className="h-5 w-5 sm:h-6 sm:w-6" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold sm:text-2xl">FitBot</h1>
              <p className="mt-1 flex flex-wrap items-center gap-1 text-sm text-emerald-100">
                <Sparkles className="h-3 w-3" />
                Assistente Fitness com IA
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="fl-app-container pb-40 pt-5 md:pb-28">
        <div className="mx-auto max-w-4xl space-y-4">
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
              className={`max-w-[85%] rounded-2xl p-3.5 sm:max-w-[75%] sm:p-4 ${
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
      </section>

      {messages.length <= 1 && !loading && (
        <section className="fl-app-container mb-4">
          <div className="mx-auto max-w-4xl">
          <p className="mb-2 text-xs text-gray-500">Perguntas rápidas:</p>
          <div className="flex flex-wrap gap-2">
            {quickQuestions.map((question, index) => (
              <button
                key={index}
                onClick={() => handleQuickQuestion(question)}
                className="min-h-11 rounded-full bg-white px-3 py-2 text-xs text-gray-700 shadow-sm transition-shadow hover:shadow-md"
              >
                {question}
              </button>
            ))}
          </div>
          </div>
        </section>
      )}

      <div className="fixed bottom-24 left-0 right-0 fl-z-card px-4 pb-4 pt-4 md:bottom-6">
        <form onSubmit={sendMessage} className="mx-auto flex w-full max-w-4xl gap-2 rounded-[1.6rem] border border-[var(--fl-border-soft)] bg-[color-mix(in_srgb,var(--fl-surface-strong)_90%,transparent)] p-2 shadow-lg backdrop-blur-xl">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Digite sua pergunta..."
            className="h-11 flex-1 rounded-full border-2 border-emerald-200 bg-white px-4 py-3 outline-none shadow-sm focus:border-emerald-500"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-lg transition-shadow hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send className="w-5 h-5" />
          </button>
        </form>
      </div>
    </AppPageShell>
  );
}
