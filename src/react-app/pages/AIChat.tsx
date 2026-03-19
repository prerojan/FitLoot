import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/react-app/contexts/auth";
import AppPageShell from "@/react-app/components/AppPageShell";
import {
  Bot,
  History,
  Settings,
  Dumbbell,
  LineChart,
  Gift,
  Utensils,
  Mic,
  Paperclip,
  ArrowUp,
} from "lucide-react";
import { api } from "@/react-app/utils/api";

type Message = {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
};

type QuickQuestion = {
  text: string;
  icon: typeof Dumbbell;
};

function renderMessageContent(text: string) {
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <span key={index} className="font-bold italic" style={{ color: "var(--app-primary-color)" }}>
          {part.slice(2, -2)}
        </span>
      );
    }

    return part;
  });
}

function parseAIResponse(text: string): string {
  if (!text) return "";

  return text
    .replace(/^\s*#{1,6}\s*/gm, "")
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return "";
      if (/^\|?\s*-{3,}/.test(trimmed) || /^\|[-\s:|]+\|$/.test(trimmed)) return "";
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
}

function getStorageKey(userId: string | undefined) {
  return `fitloot_ai_chat_${userId ?? "guest"}`;
}

const QUICK_QUESTIONS: QuickQuestion[] = [
  { text: "Sugerir proximo treino", icon: Dumbbell },
  { text: "Como estao meus stats?", icon: LineChart },
  { text: "Resgatar FitLoot", icon: Gift },
  { text: "Recomendacoes de refeicao", icon: Utensils },
];

const DEFAULT_GREETING: Message = {
  role: "assistant",
  content: "Ola! Sou o FitBot. Como posso te ajudar hoje?",
  timestamp: new Date().toISOString(),
};

export default function AIChat() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>([DEFAULT_GREETING]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionMessageCount, setSessionMessageCount] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) {
      navigate("/app");
      return;
    }

    try {
      const stored = localStorage.getItem(getStorageKey(user.id));
      if (!stored) return;
      const parsed = JSON.parse(stored) as Message[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        setMessages(parsed);
        setSessionMessageCount(parsed.filter((message) => message.role === "user").length);
      }
    } catch (storageError) {
      console.error("Error restoring AI chat history:", storageError);
    }
  }, [navigate, user]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    if (!user) return;
    try {
      localStorage.setItem(getStorageKey(user.id), JSON.stringify(messages));
    } catch (storageError) {
      console.error("Error saving AI chat history:", storageError);
    }
  }, [messages, user]);

  const submitMessage = async (content: string) => {
    const messageContent = content.trim();
    if (!messageContent || loading) return;

    const userMessage: Message = {
      role: "user",
      content: messageContent,
      timestamp: new Date().toISOString(),
    };

    const nextMessages = [...messages, userMessage];
    const nextSessionCount = sessionMessageCount + 1;

    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    setSessionMessageCount(nextSessionCount);

    try {
      const response = await api("/api/ai/chat", {
        method: "POST",
        body: JSON.stringify({
          message: messageContent,
          history: messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
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

      const payload = (await response.json()) as { message?: string | undefined };
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: parseAIResponse(String(payload.message || "")),
          timestamp: new Date().toISOString(),
        },
      ]);
    } catch (chatError) {
      console.error("Chat error:", chatError);
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: "Desculpe, tive um problema ao processar sua mensagem. Tente novamente!",
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await submitMessage(input);
  };

  const getInitials = (name?: string) => {
    if (!name) return "U";
    return name.substring(0, 2).toUpperCase();
  };

  return (
    <AppPageShell bottomNavActive="missions" className="fl-theme-page">
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--app-primary-color) 20%, transparent); border-radius: 10px; }
      `}</style>
      <div className="relative flex h-screen w-full flex-col overflow-hidden" style={{ backgroundColor: "var(--app-bg-color)" }}>
        <header className="fl-theme-topbar sticky top-0 z-10 flex items-center justify-between border-b px-6 py-4 lg:px-20 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: "color-mix(in srgb, var(--app-primary-color) 10%, transparent)", color: "var(--app-primary-color)" }}>
              <Bot className="h-7 w-7" strokeWidth={2} />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">
                FitBot <span style={{ color: "var(--app-primary-color)" }}>AI</span>
              </h1>
              <div className="flex items-center gap-1.5">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ backgroundColor: "var(--app-primary-color)" }} />
                  <span className="relative inline-flex h-2 w-2 rounded-full" style={{ backgroundColor: "var(--app-primary-color)" }} />
                </span>
                <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--app-primary-color)" }}>
                  System Online
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button className="fl-theme-surface-soft flex h-10 w-10 items-center justify-center rounded-full fl-theme-text-muted transition-all hover:opacity-80">
              <History className="h-5 w-5" />
            </button>
            <button className="fl-theme-surface-soft flex h-10 w-10 items-center justify-center rounded-full fl-theme-text-muted transition-all hover:opacity-80">
              <Settings className="h-5 w-5" />
            </button>
            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border-2 p-0.5 font-bold" style={{ borderColor: "var(--app-primary-color)", backgroundColor: "color-mix(in srgb, var(--app-primary-color) 20%, transparent)", color: "var(--app-primary-color)" }}>
              {user?.avatar_url ? (
                <img src={user.avatar_url} alt="User Avatar" className="h-full w-full rounded-full object-cover" />
              ) : (
                user?.name ? getInitials(user.name) : "U"
              )}
            </div>
          </div>
        </header>

        <main className="custom-scrollbar mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 overflow-y-auto p-4 pb-32 lg:p-10">
          {messages.map((message, index) =>
            message.role === "assistant" ? (
              <div key={`${message.timestamp}-${index}`} className="flex max-w-[85%] items-end gap-4">
                <div className="fl-theme-surface flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
                  <Bot className="h-6 w-6" style={{ color: "var(--app-primary-color)" }} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="fl-theme-text-muted ml-1 text-xs font-medium uppercase tracking-tighter">
                    FitBot AI • {new Date(message.timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <div className="fl-theme-surface rounded-2xl rounded-bl-none p-5 text-sm leading-relaxed whitespace-pre-wrap">
                    {renderMessageContent(message.content)}
                  </div>
                </div>
              </div>
            ) : (
              <div key={`${message.timestamp}-${index}`} className="ml-auto flex max-w-[80%] flex-col items-end gap-1.5">
                <div className="flex items-end gap-4">
                  <div className="flex flex-col items-end gap-1.5">
                    <span className="fl-theme-text-muted mr-1 text-xs font-medium uppercase tracking-tighter">
                      Voce • {new Date(message.timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <div className="rounded-2xl rounded-br-none p-5 text-sm font-semibold text-black shadow-lg" style={{ backgroundColor: "var(--app-primary-color)" }}>
                      {message.content}
                    </div>
                  </div>
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 p-0.5 font-bold" style={{ borderColor: "var(--app-primary-color)", backgroundColor: "color-mix(in srgb, var(--app-primary-color) 20%, transparent)", color: "var(--app-primary-color)" }}>
                    {user?.avatar_url ? (
                      <img src={user.avatar_url} alt="User Avatar" className="h-full w-full rounded-full object-cover" />
                    ) : (
                      user?.name ? getInitials(user.name) : "U"
                    )}
                  </div>
                </div>
              </div>
            ),
          )}

          {loading ? (
            <div className="flex max-w-[85%] items-end gap-4">
              <div className="fl-theme-surface flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
                <Bot className="h-6 w-6" style={{ color: "var(--app-primary-color)" }} />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="fl-theme-text-muted ml-1 text-xs font-medium uppercase tracking-tighter">
                  FitBot AI • {new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                </span>
                <div className="fl-theme-surface flex h-12 w-16 items-center justify-center gap-1 rounded-2xl rounded-bl-none p-4 shadow-xl">
                  <span className="h-2 w-2 animate-bounce rounded-full" style={{ backgroundColor: "var(--app-primary-color)", animationDelay: "0ms" }} />
                  <span className="h-2 w-2 animate-bounce rounded-full" style={{ backgroundColor: "var(--app-primary-color)", animationDelay: "150ms" }} />
                  <span className="h-2 w-2 animate-bounce rounded-full" style={{ backgroundColor: "var(--app-primary-color)", animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          ) : null}

          <div ref={messagesEndRef} />
        </main>

        <div className="fl-theme-topbar absolute bottom-0 w-full border-t p-4 backdrop-blur-xl lg:px-20 lg:pb-8">
          {messages.length <= 1 && !loading ? (
            <div className="custom-scrollbar mb-4 flex gap-3 overflow-x-auto pb-2">
              {QUICK_QUESTIONS.map((question) => (
                <button
                  key={question.text}
                  type="button"
                  onClick={() => {
                    void submitMessage(question.text);
                  }}
                  className="fl-theme-surface-soft flex h-10 shrink-0 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition-all hover:opacity-90 whitespace-nowrap"
                >
                  <question.icon className="h-5 w-5" />
                  {question.text}
                </button>
              ))}
            </div>
          ) : null}

          <form onSubmit={(event) => { void handleSubmit(event); }} className="relative mx-auto flex w-full max-w-5xl items-center">
            <div className="relative flex-1">
              <input
                type="text"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                disabled={loading}
                className="fl-theme-input w-full rounded-2xl py-4 pl-6 pr-24 outline-none"
                placeholder="Mensagem para o FitBot..."
              />
              <div className="absolute right-4 top-1/2 flex -translate-y-1/2 items-center gap-2">
                <button type="button" className="fl-theme-text-muted transition-colors hover:text-primary">
                  <Mic className="h-5 w-5" />
                </button>
                <button type="button" className="fl-theme-text-muted transition-colors hover:text-primary">
                  <Paperclip className="h-5 w-5" />
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="ml-3 flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-black shadow-lg transition-transform hover:scale-105 active:scale-95 disabled:opacity-50 disabled:grayscale"
              style={{ backgroundColor: "var(--app-primary-color)" }}
            >
              <ArrowUp className="h-6 w-6" strokeWidth={3} />
            </button>
          </form>
        </div>
      </div>
    </AppPageShell>
  );
}
