import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import {
  ArrowLeft,
  ArrowUp,
  Bot,
  Dumbbell,
  Gift,
  History,
  LineChart,
  Mic,
  Paperclip,
  Utensils,
  X,
} from "lucide-react";
import AppPageShell from "@/react-app/components/AppPageShell";
import { useAuth } from "@/react-app/contexts/auth";
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
        <span
          key={index}
          className="font-bold italic"
          style={{ color: "var(--app-primary-color)" }}
        >
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

function createGreetingMessage(): Message {
  return {
    role: "assistant",
    content: "Olá! Sou o FitBot. Como posso te ajudar hoje?",
    timestamp: new Date().toISOString(),
  };
}

const QUICK_QUESTIONS: QuickQuestion[] = [
  { text: "Sugerir próximo treino", icon: Dumbbell },
  { text: "Como estão meus stats?", icon: LineChart },
  { text: "Resgatar FitLoot", icon: Gift },
  { text: "Recomendações de refeição", icon: Utensils },
];

function HistoryModal({
  messages,
  onClose,
  onClear,
}: {
  messages: Message[];
  onClose: () => void;
  onClear: () => void;
}) {
  return (
    <div
      className="fl-z-modal fixed inset-0 flex items-center justify-center bg-black/55 p-4 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="fl-theme-surface w-full max-w-xl rounded-[2rem] p-5 sm:p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-black tracking-tight sm:text-xl">
              Histórico da conversa
            </h2>
            <p className="fl-theme-text-muted text-[0.65rem] font-bold uppercase tracking-[0.18em] sm:text-[0.7rem]">
              {messages.length} mensagens nesta sessão
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="fl-theme-surface-soft flex h-10 w-10 items-center justify-center rounded-full fl-theme-text-muted transition-opacity hover:opacity-80"
            aria-label="Fechar histórico"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="custom-scrollbar max-h-[60vh] space-y-3 overflow-y-auto pr-1">
          {messages.map((message, index) => (
            <div
              key={`${message.timestamp}-${index}`}
              className="fl-theme-surface-soft rounded-2xl p-3 sm:p-4"
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <span
                  className="text-[0.68rem] font-black uppercase tracking-[0.16em]"
                  style={{
                    color:
                      message.role === "assistant"
                        ? "var(--app-primary-color)"
                        : "var(--fl-color-text)",
                  }}
                >
                  {message.role === "assistant" ? "FitBot" : "Você"}
                </span>
                <span className="fl-theme-text-muted text-[0.68rem] font-bold">
                  {new Date(message.timestamp).toLocaleString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              <p className="text-sm leading-relaxed sm:text-base">{message.content}</p>
            </div>
          ))}
        </div>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={onClose}
            className="fl-theme-input flex-1 rounded-2xl px-4 py-3 text-sm font-bold uppercase tracking-[0.16em] transition-opacity hover:opacity-80"
          >
            Fechar
          </button>
          <button
            type="button"
            onClick={onClear}
            className="flex-1 rounded-2xl px-4 py-3 text-sm font-black uppercase tracking-[0.16em] transition-transform hover:scale-[1.01] active:scale-95"
            style={{ backgroundColor: "var(--app-primary-color)", color: "var(--fl-nav-item-active-text)" }}
          >
            Limpar histórico
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AIChat() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>(() => [createGreetingMessage()]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionMessageCount, setSessionMessageCount] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) {
      navigate("/app");
      return;
    }

    try {
      const stored = localStorage.getItem(getStorageKey(user.id));
      if (!stored) {
        setMessages([createGreetingMessage()]);
        setSessionMessageCount(0);
        return;
      }

      const parsed = JSON.parse(stored) as Message[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        setMessages(parsed);
        setSessionMessageCount(
          parsed.filter((message) => message.role === "user").length,
        );
        return;
      }
    } catch (storageError) {
      console.error("Error restoring AI chat history:", storageError);
    }

    setMessages([createGreetingMessage()]);
    setSessionMessageCount(0);
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

  const clearHistory = () => {
    const greetingMessage = createGreetingMessage();
    if (user) {
      localStorage.removeItem(getStorageKey(user.id));
    }
    setMessages([greetingMessage]);
    setSessionMessageCount(0);
    setHistoryOpen(false);
  };

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
          history: nextMessages.map((message) => ({
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
        const payload = (await response.json().catch(() => null)) as {
          error?: string | undefined;
        } | null;
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
          content:
            "Desculpe, tive um problema ao processar sua mensagem. Tente novamente.",
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

      <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
        <header className="fl-theme-topbar shrink-0 border-b px-3 py-3 backdrop-blur-md sm:px-4 lg:px-8">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="fl-theme-surface-soft flex h-11 w-11 items-center justify-center rounded-full fl-theme-text-muted transition-opacity hover:opacity-80"
              aria-label="Voltar"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>

            <div className="min-w-0 flex-1 text-center">
              <h1 className="truncate text-base font-black tracking-tight sm:text-lg">
                FitBot <span style={{ color: "var(--app-primary-color)" }}>AI</span>
              </h1>
              <div className="mt-1 flex items-center justify-center gap-1.5">
                <span className="relative flex h-2 w-2">
                  <span
                    className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
                    style={{ backgroundColor: "var(--app-primary-color)" }}
                  />
                  <span
                    className="relative inline-flex h-2 w-2 rounded-full"
                    style={{ backgroundColor: "var(--app-primary-color)" }}
                  />
                </span>
                <span
                  className="text-[0.68rem] font-bold uppercase tracking-[0.16em]"
                  style={{ color: "var(--app-primary-color)" }}
                >
                  Sistema online
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              className="fl-theme-surface-soft flex h-11 w-11 items-center justify-center rounded-full fl-theme-text-muted transition-opacity hover:opacity-80"
              aria-label="Abrir histórico"
            >
              <History className="h-5 w-5" />
            </button>
          </div>
        </header>

        <main className="custom-scrollbar mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-4 overflow-y-auto px-3 py-4 pb-3 sm:px-4 sm:pb-4 lg:px-8 lg:py-6 lg:pb-5">
          {messages.map((message, index) =>
            message.role === "assistant" ? (
              <div
                key={`${message.timestamp}-${index}`}
                className="flex max-w-[88%] items-end gap-3 sm:max-w-[82%] sm:gap-4"
              >
                <div className="fl-theme-surface flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
                  <Bot
                    className="h-5 w-5 sm:h-6 sm:w-6"
                    style={{ color: "var(--app-primary-color)" }}
                  />
                </div>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <span className="fl-theme-text-muted ml-1 text-[0.68rem] font-bold uppercase tracking-[0.12em]">
                    FitBot •{" "}
                    {new Date(message.timestamp).toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <div className="fl-theme-surface rounded-2xl rounded-bl-none p-3 text-sm leading-relaxed whitespace-pre-wrap sm:p-4 sm:text-base">
                    {renderMessageContent(message.content)}
                  </div>
                </div>
              </div>
            ) : (
              <div
                key={`${message.timestamp}-${index}`}
                className="ml-auto flex max-w-[88%] flex-col items-end gap-1.5 sm:max-w-[80%]"
              >
                <div className="flex items-end gap-3 sm:gap-4">
                  <div className="flex min-w-0 flex-col items-end gap-1.5">
                    <span className="fl-theme-text-muted mr-1 text-[0.68rem] font-bold uppercase tracking-[0.12em]">
                      Você •{" "}
                      {new Date(message.timestamp).toLocaleTimeString("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <div
                      className="rounded-2xl rounded-br-none p-3 text-sm font-semibold shadow-lg whitespace-pre-wrap sm:p-4 sm:text-base"
                      style={{
                        backgroundColor: "var(--app-primary-color)",
                        color: "var(--fl-nav-item-active-text)",
                      }}
                    >
                      {message.content}
                    </div>
                  </div>
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 p-0.5 font-bold"
                    style={{
                      borderColor: "var(--app-primary-color)",
                      backgroundColor:
                        "color-mix(in srgb, var(--app-primary-color) 20%, transparent)",
                      color: "var(--app-primary-color)",
                    }}
                  >
                    {user?.avatar_url ? (
                      <img
                        src={user.avatar_url}
                        alt="Avatar do usuário"
                        className="h-full w-full rounded-full object-cover"
                      />
                    ) : (
                      user?.name ? getInitials(user.name) : "U"
                    )}
                  </div>
                </div>
              </div>
            ),
          )}

          {loading ? (
            <div className="flex max-w-[88%] items-end gap-3 sm:max-w-[82%] sm:gap-4">
              <div className="fl-theme-surface flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
                <Bot
                  className="h-5 w-5 sm:h-6 sm:w-6"
                  style={{ color: "var(--app-primary-color)" }}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="fl-theme-text-muted ml-1 text-[0.68rem] font-bold uppercase tracking-[0.12em]">
                  FitBot • digitando...
                </span>
                <div className="fl-theme-surface flex h-12 w-16 items-center justify-center gap-1 rounded-2xl rounded-bl-none p-4 shadow-xl">
                  <span
                    className="h-2 w-2 animate-bounce rounded-full"
                    style={{
                      backgroundColor: "var(--app-primary-color)",
                      animationDelay: "0ms",
                    }}
                  />
                  <span
                    className="h-2 w-2 animate-bounce rounded-full"
                    style={{
                      backgroundColor: "var(--app-primary-color)",
                      animationDelay: "150ms",
                    }}
                  />
                  <span
                    className="h-2 w-2 animate-bounce rounded-full"
                    style={{
                      backgroundColor: "var(--app-primary-color)",
                      animationDelay: "300ms",
                    }}
                  />
                </div>
              </div>
            </div>
          ) : null}

          <div ref={messagesEndRef} />
        </main>

        <div className="fl-theme-topbar sticky bottom-0 z-10 shrink-0 border-t px-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] pt-3 backdrop-blur-xl sm:px-4 lg:px-8 lg:pt-4">
          <div className="mx-auto w-full max-w-5xl">
            {messages.length <= 1 && !loading ? (
              <div className="custom-scrollbar mb-3 flex gap-2 overflow-x-auto pb-1 sm:mb-4 sm:gap-3">
                {QUICK_QUESTIONS.map((question) => (
                  <button
                    key={question.text}
                    type="button"
                    onClick={() => {
                      void submitMessage(question.text);
                    }}
                    className="fl-theme-surface-soft flex h-10 shrink-0 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold transition-opacity hover:opacity-90 whitespace-nowrap"
                  >
                    <question.icon className="h-4 w-4 sm:h-5 sm:w-5" />
                    {question.text}
                  </button>
                ))}
              </div>
            ) : null}

            <form
              onSubmit={(event) => {
                void handleSubmit(event);
              }}
              className="flex items-end gap-3"
            >
              <div className="relative flex-1">
                <input
                  type="text"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  disabled={loading}
                  className="fl-theme-input min-h-[3.5rem] w-full rounded-2xl px-4 py-3.5 pr-24 text-sm outline-none sm:text-base"
                  placeholder="Mensagem para o FitBot..."
                />
                <div className="absolute right-4 top-1/2 flex -translate-y-1/2 items-center gap-2">
                  <button
                    type="button"
                    className="fl-theme-text-muted transition-colors hover:opacity-80"
                    aria-label="Usar microfone"
                  >
                    <Mic className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    className="fl-theme-text-muted transition-colors hover:opacity-80"
                    aria-label="Anexar arquivo"
                  >
                    <Paperclip className="h-5 w-5" />
                  </button>
                </div>
              </div>
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl shadow-lg transition-transform hover:scale-105 active:scale-95 disabled:opacity-50 disabled:grayscale"
                style={{
                  backgroundColor: "var(--app-primary-color)",
                  color: "var(--fl-nav-item-active-text)",
                }}
              >
                <ArrowUp className="h-6 w-6" strokeWidth={3} />
              </button>
            </form>
          </div>
        </div>

        {historyOpen ? (
          <HistoryModal
            messages={messages}
            onClose={() => setHistoryOpen(false)}
            onClear={clearHistory}
          />
        ) : null}
      </div>
    </AppPageShell>
  );
}
