// ====================================
// src/react-app/pages/AIChat.tsx
// Componente de Chatbot com IA
// ====================================

import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/react-app/contexts/auth";
import AppPageShell from "@/react-app/components/AppPageShell";
import { Bot, History, Settings, Dumbbell, LineChart, Gift, Utensils, Mic, Paperclip, ArrowUp } from "lucide-react";
import { api } from "@/react-app/utils/api";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

function renderMessageContent(text: string) {
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <span key={i} className="font-bold italic" style={{ color: "var(--app-primary-color)" }}>{part.slice(2, -2)}</span>;
    }
    return part;
  });
}

function parseAIResponse(text: string): string {
  if (!text) return "";

  const lines = text
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
    { text: "Sugerir próximo treino", icon: Dumbbell },
    { text: "Como estão meus stats?", icon: LineChart },
    { text: "Resgatar FitLoot", icon: Gift },
    { text: "Recomendações de refeição", icon: Utensils },
  ];

  const handleQuickQuestion = (question: string) => {
    setInput(question);
    setTimeout(() => {
      const form = document.getElementById("chat-form");
      if (form) form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    }, 50);
  };

  const getInitials = (name?: string) => {
    if (!name) return "U";
    return name.substring(0, 2).toUpperCase();
  };

  return (
    <AppPageShell bottomNavActive="missions" className="bg-background-light dark:bg-background-dark font-display text-slate-900 dark:text-slate-100 antialiased fl-z-mission-screen">
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--app-primary-color) 20%, transparent); border-radius: 10px; }
        .glass-bot {
            background: var(--fl-surface-strong, #1a1a1a);
            border: 1px solid rgba(255, 255, 255, 0.1);
        }
        `}</style>
      <div className="relative flex h-screen w-full flex-col overflow-hidden" style={{ backgroundColor: "var(--app-bg-color, #060b08)" }}>
        {/* Header */}
        <header className="flex items-center justify-between border-b px-6 py-4 lg:px-20 sticky top-0 z-50 transition-all backdrop-blur-md" style={{ borderColor: "rgba(255, 255, 255, 0.05)", backgroundColor: "color-mix(in srgb, var(--fl-surface-strong) 80%, transparent)" }}>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: "color-mix(in srgb, var(--app-primary-color) 10%, transparent)", color: "var(--app-primary-color)" }}>
              <Bot className="w-7 h-7" strokeWidth={2} />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white">
                FitBot <span style={{ color: "var(--app-primary-color)" }}>AI</span>
              </h1>
              <div className="flex items-center gap-1.5">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: "var(--app-primary-color)" }}></span>
                  <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: "var(--app-primary-color)" }}></span>
                </span>
                <span className="text-[10px] uppercase tracking-widest font-bold" style={{ color: "var(--app-primary-color)" }}>System Online</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button className="flex h-10 w-10 items-center justify-center rounded-full bg-white/5 text-slate-300 transition-all hover:opacity-80">
              <History className="w-5 h-5" />
            </button>
            <button className="flex h-10 w-10 items-center justify-center rounded-full bg-white/5 text-slate-300 transition-all hover:opacity-80">
              <Settings className="w-5 h-5" />
            </button>
            <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 p-0.5 overflow-hidden font-bold" style={{ borderColor: "var(--app-primary-color)", backgroundColor: "color-mix(in srgb, var(--app-primary-color) 20%, transparent)", color: "var(--app-primary-color)" }}>
              {user?.avatar_url ? (
                <img src={user.avatar_url} alt="User Avatar" className="h-full w-full rounded-full object-cover" />
              ) : (
                user?.name ? getInitials(user.name) : "U"
              )}
            </div>
          </div>
        </header>

        {/* Chat Container */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-10 space-y-8 max-w-5xl mx-auto w-full custom-scrollbar pb-32">
          {messages.map((message, index) => (
            message.role === "assistant" ? (
              /* Bot Message */
              <div key={index} className="flex items-end gap-4 max-w-[85%]">
                <div className="h-10 w-10 shrink-0 rounded-full glass-bot flex items-center justify-center">
                  <Bot className="w-6 h-6" style={{ color: "var(--app-primary-color)" }} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-slate-500 ml-1 uppercase tracking-tighter">
                    FitBot AI • {message.timestamp.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <div className="glass-bot p-5 rounded-2xl rounded-bl-none text-slate-200 leading-relaxed shadow-xl text-sm whitespace-pre-wrap">
                    {renderMessageContent(message.content)}
                  </div>
                </div>
              </div>
            ) : (
              /* User Message */
              <div key={index} className="flex flex-col items-end gap-1.5 ml-auto max-w-[80%]">
                <div className="flex items-end gap-4">
                  <div className="flex flex-col gap-1.5 items-end">
                    <span className="text-xs font-medium text-slate-500 mr-1 uppercase tracking-tighter">
                      Você • {message.timestamp.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <div className="p-5 rounded-2xl rounded-br-none font-semibold shadow-lg text-sm" style={{ backgroundColor: "var(--app-primary-color)", color: "#000", boxShadow: "0 10px 15px -3px color-mix(in srgb, var(--app-primary-color) 10%, transparent)" }}>
                      {message.content}
                    </div>
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center shrink-0 rounded-full border-2 p-0.5 overflow-hidden font-bold" style={{ borderColor: "var(--app-primary-color)", backgroundColor: "color-mix(in srgb, var(--app-primary-color) 20%, transparent)", color: "var(--app-primary-color)" }}>
                    {user?.avatar_url ? (
                      <img src={user.avatar_url} alt="User Avatar" className="h-full w-full rounded-full object-cover" />
                    ) : (
                      user?.name ? getInitials(user.name) : "U"
                    )}
                  </div>
                </div>
              </div>
            )
          ))}

          {/* Typing Indicator */}
          {loading && (
            <div className="flex items-end gap-4 max-w-[85%]">
              <div className="h-10 w-10 shrink-0 rounded-full glass-bot flex items-center justify-center">
                <Bot className="w-6 h-6" style={{ color: "var(--app-primary-color)" }} />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-slate-500 ml-1 uppercase tracking-tighter">
                  FitBot AI • {new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                </span>
                <div className="glass-bot p-4 rounded-2xl rounded-bl-none shadow-xl flex gap-1 items-center justify-center w-16 h-12">
                  <span className="h-2 w-2 rounded-full animate-bounce" style={{ backgroundColor: "var(--app-primary-color)", animationDelay: "0ms" }}></span>
                  <span className="h-2 w-2 rounded-full animate-bounce" style={{ backgroundColor: "var(--app-primary-color)", animationDelay: "150ms" }}></span>
                  <span className="h-2 w-2 rounded-full animate-bounce" style={{ backgroundColor: "var(--app-primary-color)", animationDelay: "300ms" }}></span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </main>

        {/* Bottom Actions & Input */}
        <div className="absolute bottom-0 w-full p-4 lg:px-20 lg:pb-8 border-t backdrop-blur-xl" style={{ borderColor: "rgba(255, 255, 255, 0.05)", backgroundColor: "color-mix(in srgb, var(--fl-surface-strong) 80%, transparent)" }}>
          
          {/* Suggested Questions */}
          {messages.length <= 1 && !loading && (
            <div className="flex gap-3 mb-4 overflow-x-auto pb-2 custom-scrollbar">
              {quickQuestions.map((q, index) => (
                <button
                  key={index}
                  onClick={() => handleQuickQuestion(q.text)}
                  type="button"
                  className="flex h-10 shrink-0 items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 px-5 text-sm font-semibold text-slate-300 transition-all hover:text-black whitespace-nowrap"
                  style={{ '--tw-hover-bg': 'var(--app-primary-color)' } as React.CSSProperties}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--app-primary-color)"; e.currentTarget.style.color = "#000"; e.currentTarget.style.borderColor = "var(--app-primary-color)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.05)"; e.currentTarget.style.color = "rgb(203 213 225)"; e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.1)"; }}
                >
                  <q.icon className="w-5 h-5" />
                  {q.text}
                </button>
              ))}
            </div>
          )}

          {/* Input Box */}
          <form id="chat-form" onSubmit={sendMessage} className="relative flex items-center max-w-5xl mx-auto w-full">
            <div className="flex-1 relative">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={loading}
                className="w-full rounded-2xl border-none bg-white/5 py-4 pl-6 pr-24 text-white placeholder:text-slate-500 focus:ring-1 transition-all outline-none"
                style={{ '--tw-ring-color': 'color-mix(in srgb, var(--app-primary-color) 50%, transparent)' } as React.CSSProperties}
                placeholder="Mensagem para o FitBot..."
              />
              <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
                <button type="button" className="text-slate-500 transition-colors" onMouseEnter={(e) => e.currentTarget.style.color="var(--app-primary-color)"} onMouseLeave={(e) => e.currentTarget.style.color="rgb(100 116 139)"}>
                  <Mic className="w-5 h-5" />
                </button>
                <button type="button" className="text-slate-500 transition-colors" onMouseEnter={(e) => e.currentTarget.style.color="var(--app-primary-color)"} onMouseLeave={(e) => e.currentTarget.style.color="rgb(100 116 139)"}>
                  <Paperclip className="w-5 h-5" />
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="ml-3 flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-black shadow-lg transition-transform hover:scale-105 active:scale-95 disabled:opacity-50 disabled:grayscale"
              style={{ backgroundColor: "var(--app-primary-color)", boxShadow: "0 10px 15px -3px color-mix(in srgb, var(--app-primary-color) 20%, transparent)" }}
            >
              <ArrowUp className="w-6 h-6" strokeWidth={3} />
            </button>
          </form>
        </div>
      </div>
    </AppPageShell>
  );
}
