import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEventHandler, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { Award, Dumbbell, LogOut, Settings, Target, Trophy } from "lucide-react";
import { useAuth } from "@/react-app/contexts/auth";
import BottomNav from "@/react-app/components/BottomNav";
import LoadingBall from "@/react-app/components/LoadingBall";
import ProfileFriendsPanel from "@/react-app/components/ProfileFriendsPanel";
import type {
  AchievementWithUnlock,
  SkillWithProgress,
  TitleWithUnlock,
  UserAttributes,
  UserProfile,
  UserProgression,
} from "@/shared/types";
import { ApiRequestError, api, clearJsonCache, fetchAndCacheJson, readCachedJson } from "@/react-app/utils/api";
import { applyProfileTheme } from "@/react-app/utils/theme";

const DEFAULT_PRIMARY_COLOR = "#10b981";
const DEFAULT_SECONDARY_COLOR = "#14b8a6";
const FONT_OPTIONS = [
  { label: "Rajdhani", value: "rajdhani", family: "Rajdhani, sans-serif" },
  { label: "Orbitron", value: "orbitron", family: "Orbitron, sans-serif" },
  { label: "Exo 2", value: "exo2", family: "Exo 2, sans-serif" },
  { label: "Bebas Neue", value: "bebas-neue", family: "Bebas Neue, sans-serif" },
  { label: "Teko", value: "teko", family: "Teko, sans-serif" },
  { label: "Russo One", value: "russo-one", family: "Russo One, sans-serif" },
  { label: "Audiowide", value: "audiowide", family: "Audiowide, sans-serif" },
  { label: "Press Start 2P", value: "press-start-2p", family: "\"Press Start 2P\", cursive" },
  { label: "Cinzel", value: "cinzel", family: "Cinzel, serif" },
  { label: "Bangers", value: "bangers", family: "Bangers, cursive" },
] as const;

const ATTRIBUTE_META = [
  { key: "strength", label: "FOR", color: "from-red-500 to-orange-500" },
  { key: "constitution", label: "CON", color: "from-blue-500 to-cyan-500" },
  { key: "vitality", label: "VIT", color: "from-green-500 to-emerald-500" },
  { key: "dexterity", label: "DES", color: "from-purple-500 to-pink-500" },
  { key: "focus", label: "FOCO", color: "from-yellow-500 to-amber-500" },
] as const;

function rarityKey(value: string | undefined) {
  if (!value) return "Comum";
  const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (normalized.includes("lendario")) return "Lendario";
  if (normalized.includes("epico")) return "Epico";
  if (normalized.includes("raro")) return "Raro";
  if (normalized.includes("incomum")) return "Incomum";
  if (normalized.includes("mitico")) return "Mitico";
  if (normalized.includes("secreto")) return "Secreto";
  return "Comum";
}

function TabButton({ icon, label, active, onClick }: { icon: ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium transition-all ${
        active ? "bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-md" : "text-gray-600 hover:bg-gray-50"
      }`}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

export default function Profile() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [attributes, setAttributes] = useState<UserAttributes | null>(null);
  const [progression, setProgression] = useState<UserProgression | null>(null);
  const [skills, setSkills] = useState<SkillWithProgress[]>([]);
  const [achievements, setAchievements] = useState<AchievementWithUnlock[]>([]);
  const [titles, setTitles] = useState<TitleWithUnlock[]>([]);
  const [section, setSection] = useState<"profile" | "friends">("profile");
  const [tab, setTab] = useState<"attributes" | "skills" | "achievements" | "titles">("attributes");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [customizationSaving, setCustomizationSaving] = useState(false);
  const [bgPreview, setBgPreview] = useState<string | null>(null);
  const [primaryColor, setPrimaryColor] = useState(DEFAULT_PRIMARY_COLOR);
  const [secondaryColor, setSecondaryColor] = useState(DEFAULT_SECONDARY_COLOR);
  const [customFont, setCustomFont] = useState("rajdhani");
  const [feedbackType, setFeedbackType] = useState<"Sugestao" | "Bug" | "Elogio" | "Outro">("Sugestao");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [feedbackSending, setFeedbackSending] = useState(false);
  const [feedbackStatus, setFeedbackStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const primaryColorInputRef = useRef<HTMLInputElement>(null);
  const secondaryColorInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const updateViewport = () => setIsMobile(window.innerWidth <= 768);
    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  const syncProfileThemeState = useCallback((nextProfile: UserProfile) => {
    setProfile(nextProfile);
    setBgPreview(nextProfile.custom_background_type === "image" ? nextProfile.custom_background_value ?? null : null);
    setPrimaryColor(nextProfile.custom_primary_color ?? DEFAULT_PRIMARY_COLOR);
    setSecondaryColor(nextProfile.custom_secondary_color ?? DEFAULT_SECONDARY_COLOR);
    setCustomFont(nextProfile.custom_font ?? "rajdhani");
    applyProfileTheme(nextProfile);
  }, []);

  const loadData = useCallback(async () => {
    setError(null);
    const cachedProfile = readCachedJson<UserProfile>("/api/profile");
    const cachedAttributes = readCachedJson<UserAttributes>("/api/attributes");
    const cachedProgression = readCachedJson<UserProgression>("/api/progression");
    const cachedSkills = readCachedJson<SkillWithProgress[]>("/api/skills");
    const cachedAchievements = readCachedJson<AchievementWithUnlock[]>("/api/achievements");
    const cachedTitles = readCachedJson<TitleWithUnlock[]>("/api/titles");
    if (cachedProfile) syncProfileThemeState(cachedProfile.data);
    if (cachedAttributes) setAttributes(cachedAttributes.data);
    if (cachedProgression) setProgression(cachedProgression.data);
    if (cachedSkills) setSkills(Array.isArray(cachedSkills.data) ? cachedSkills.data : []);
    if (cachedAchievements) setAchievements(Array.isArray(cachedAchievements.data) ? cachedAchievements.data : []);
    if (cachedTitles) setTitles(Array.isArray(cachedTitles.data) ? cachedTitles.data : []);
    const hasCache = Boolean(cachedProfile || cachedAttributes || cachedProgression || cachedSkills || cachedAchievements || cachedTitles);
    if (hasCache) setLoading(false);
    const run = async <T,>(path: string, cache: { stale: boolean } | null, onSuccess: (value: T) => void) => {
      if (cache && !cache.stale) return;
      onSuccess(await fetchAndCacheJson<T>(path));
    };
    try {
      await Promise.all([
        run<UserProfile>("/api/profile", cachedProfile, syncProfileThemeState),
        run<UserAttributes>("/api/attributes", cachedAttributes, setAttributes),
        run<UserProgression>("/api/progression", cachedProgression, setProgression),
        run<SkillWithProgress[]>("/api/skills", cachedSkills, (value) => setSkills(Array.isArray(value) ? value : [])),
        run<AchievementWithUnlock[]>("/api/achievements", cachedAchievements, (value) => setAchievements(Array.isArray(value) ? value : [])),
        run<TitleWithUnlock[]>("/api/titles", cachedTitles, (value) => setTitles(Array.isArray(value) ? value : [])),
      ]);
    } catch (loadError) {
      if (loadError instanceof ApiRequestError && (loadError.status === 401 || loadError.status === 403)) {
        navigate("/app", { replace: true });
        return;
      }
      if (!hasCache) setError("Nao foi possivel carregar o perfil agora.");
    } finally {
      setLoading(false);
    }
  }, [navigate, syncProfileThemeState]);

  useEffect(() => {
    if (!user) {
      navigate("/app", { replace: true });
      return;
    }
    void loadData();
  }, [user, navigate, loadData]);

  const applyThemePreview = useCallback((changes: Partial<Pick<UserProfile, "custom_primary_color" | "custom_secondary_color" | "custom_font" | "custom_background_type" | "custom_background_value">>) => {
    applyProfileTheme({
      custom_primary_color: changes.custom_primary_color ?? profile?.custom_primary_color ?? primaryColor,
      custom_secondary_color: changes.custom_secondary_color ?? profile?.custom_secondary_color ?? secondaryColor,
      custom_font: changes.custom_font ?? profile?.custom_font ?? customFont,
      custom_background_type: changes.custom_background_type ?? profile?.custom_background_type ?? "color",
      custom_background_value: changes.custom_background_value ?? profile?.custom_background_value ?? "#f8fafc",
    });
  }, [customFont, primaryColor, profile, secondaryColor]);

  const saveCustomization = useCallback(async (payload: Record<string, unknown>) => {
    try {
      setCustomizationSaving(true);
      const response = await api("/api/profile/customization", { method: "POST", body: JSON.stringify(payload) });
      if (!response.ok) throw new Error("Falha ao salvar personalizacao.");
      const data = (await response.json()) as { profile?: UserProfile | undefined };
      if (data.profile) syncProfileThemeState(data.profile);
    } catch {
      setError("Nao foi possivel salvar personalizacao agora.");
    } finally {
      setCustomizationSaving(false);
    }
  }, [syncProfileThemeState]);

  const activeTitle = useMemo(() => titles.find((item) => item.is_active === 1), [titles]);
  const retry = () => { setLoading(true); void loadData(); };
  const handleLogout = async () => { try { await api("/api/logout"); } finally { logout(); clearJsonCache(); navigate("/app", { replace: true }); } };
  const activateTitle = async (titleId: number) => { try { await api(`/api/titles/${titleId}/activate`, { method: "POST" }); clearJsonCache("/api/titles"); await loadData(); } catch { setError("Nao foi possivel ativar o titulo agora."); } };
  const updateFocus = async (focus: "calistenia" | "yoga") => { try { await api("/api/profile/skill-focus", { method: "POST", body: JSON.stringify({ active_skill_focus: focus }) }); setProfile((current) => current ? { ...current, active_skill_focus: focus } : current); } catch { setError("Nao foi possivel alterar o foco agora."); } };
  const updateColor = async (key: "custom_primary_color" | "custom_secondary_color", value: string) => { if (key === "custom_primary_color") setPrimaryColor(value); else setSecondaryColor(value); applyThemePreview({ [key]: value }); await saveCustomization({ [key]: value }); };
  const updateFont = async (value: string) => { setCustomFont(value); applyThemePreview({ custom_font: value }); await saveCustomization({ custom_font: value }); };
  const applySolidBackground = async () => { applyThemePreview({ custom_background_type: "color", custom_background_value: "#0f172a" }); await saveCustomization({ custom_background_type: "color", custom_background_value: "#0f172a" }); };
  const pickBackgroundImage: ChangeEventHandler<HTMLInputElement> = async (event) => { const file = event.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = async () => { const value = String(reader.result || ""); if (!value.includes(",")) return; setBgPreview(value); applyThemePreview({ custom_background_type: "image", custom_background_value: value }); await saveCustomization({ custom_background_type: "image", custom_background_value: value }); }; reader.readAsDataURL(file); };
  const sendFeedback = async () => { if (feedbackMessage.trim().length < 5) { setFeedbackStatus({ type: "error", message: "Escreva pelo menos 5 caracteres." }); return; } try { setFeedbackSending(true); setFeedbackStatus(null); const response = await api("/api/feedback", { method: "POST", body: JSON.stringify({ type: feedbackType, message: feedbackMessage.trim() }) }); if (!response.ok) { const payload = (await response.json().catch(() => null)) as { error?: string | undefined } | null; throw new Error(payload?.error ?? "Falha ao enviar feedback."); } setFeedbackMessage(""); setFeedbackType("Sugestao"); setFeedbackStatus({ type: "success", message: "Feedback enviado! Obrigado." }); } catch (submitError) { setFeedbackStatus({ type: "error", message: submitError instanceof Error ? submitError.message : "Nao foi possivel enviar feedback agora." }); } finally { setFeedbackSending(false); } };

  if (loading && !profile && !attributes && !progression) return <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 pb-24"><div className="space-y-4 px-6 py-10"><div className="fl-card flex items-center justify-center p-6"><LoadingBall size="md" /></div><div className="fl-card flex items-center justify-center p-6"><LoadingBall size="sm" /></div></div><BottomNav active="profile" /></div>;
  if (error) return <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 pb-24"><div className="px-6 py-12 text-center"><p className="mb-4 text-red-600">{error}</p><button onClick={retry} className="fl-btn-primary rounded-xl px-4 py-2">Tentar novamente</button></div><BottomNav active="profile" /></div>;

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 pb-24">
      <div className="rounded-b-3xl px-6 pb-8 pt-8 text-white shadow-xl" style={{ background: "linear-gradient(90deg, var(--app-primary-color), var(--app-secondary-color))" }}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div><h1 className="fl-profile-title text-3xl font-bold">{profile?.full_name}</h1><p className="text-emerald-100">@{profile?.username}</p>{activeTitle ? <div className="mt-2 inline-block rounded-full bg-white/20 px-4 py-1.5 text-sm font-medium backdrop-blur-sm">{activeTitle.name}</div> : null}</div>
          <div className="flex items-center gap-2"><button onClick={() => setSettingsOpen(true)} className="text-white/80 transition-colors hover:text-white" aria-label="Abrir configuracoes"><Settings className="h-6 w-6" /></button><button onClick={() => { void handleLogout(); }} className="text-white/80 transition-colors hover:text-white" aria-label="Sair"><LogOut className="h-6 w-6" /></button></div>
        </div>
        <div className="mt-6 grid grid-cols-3 gap-4">{[{ label: "Nivel", value: progression?.level || 1 }, { label: "XP Total", value: (progression?.level || 1) * 100 + (progression?.xp || 0) }, { label: "Pontos", value: progression?.points || 0 }].map((item) => <div key={item.label} className="rounded-2xl bg-white/20 p-3 text-center backdrop-blur-sm"><div className="text-2xl font-bold">{item.value.toLocaleString()}</div><div className="text-xs text-emerald-100">{item.label}</div></div>)}</div>
      </div>
      <div className="mt-6 px-6"><div className="flex gap-1 rounded-2xl bg-white/80 p-1 shadow-lg backdrop-blur-sm"><button onClick={() => setSection("profile")} className={`flex-1 rounded-xl py-3 text-sm font-medium transition-all ${section === "profile" ? "bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-md" : "text-gray-600 hover:bg-gray-50"}`}>Perfil</button><button onClick={() => setSection("friends")} className={`flex-1 rounded-xl py-3 text-sm font-medium transition-all ${section === "friends" ? "bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-md" : "text-gray-600 hover:bg-gray-50"}`}>Amigos</button></div></div>
      {section === "profile" ? <><div className="mt-4 px-6"><div className="flex gap-1 rounded-2xl bg-white/80 p-1 shadow-lg backdrop-blur-sm"><TabButton icon={<Target className="h-4 w-4" />} label="Atributos" active={tab === "attributes"} onClick={() => setTab("attributes")} /><TabButton icon={<Dumbbell className="h-4 w-4" />} label="Habilidades" active={tab === "skills"} onClick={() => setTab("skills")} /><TabButton icon={<Trophy className="h-4 w-4" />} label="Conquistas" active={tab === "achievements"} onClick={() => setTab("achievements")} /><TabButton icon={<Award className="h-4 w-4" />} label="Titulos" active={tab === "titles"} onClick={() => setTab("titles")} /></div></div><div className="mt-6 px-6 pb-6">{tab === "attributes" && attributes ? <div className="space-y-4">{ATTRIBUTE_META.map((item) => { const value = Number(attributes[item.key]); return <div key={item.key} className="rounded-2xl bg-white/80 p-4 shadow-lg backdrop-blur-sm"><div className="mb-2 flex items-center justify-between"><span className="font-semibold text-gray-900">{item.label}</span><span className="text-2xl font-bold text-gray-900">{value}</span></div><div className="h-4 overflow-hidden rounded-full bg-gray-200"><div className={`h-full rounded-full bg-gradient-to-r ${item.color}`} style={{ width: `${Math.min((value / 200) * 100, 100)}%` }} /></div></div>; })}</div> : null}{tab === "skills" ? <div className="space-y-3">{skills.length === 0 ? <p className="py-8 text-center text-gray-500">Nenhuma habilidade desbloqueada ainda</p> : skills.map((skill) => <div key={skill.id} className="rounded-2xl bg-white/80 p-4 shadow-lg backdrop-blur-sm"><div className="mb-2 flex items-start justify-between"><div><h3 className="font-semibold text-gray-900">{skill.name}</h3><p className="text-sm text-gray-600">{skill.description}</p></div><span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">{skill.difficulty}</span></div><div className="mt-3 flex gap-4 text-sm text-gray-600"><span>Total: {skill.total_reps} reps</span><span>Melhor: {skill.best_reps} reps</span></div></div>)}</div> : null}{tab === "achievements" ? <div className="grid grid-cols-2 gap-3">{achievements.map((achievement) => { const unlocked = achievement.unlocked === 1; const secretLocked = Number(achievement.secret ?? 0) === 1 && !unlocked; const accent = unlocked ? achievement.color || { Comum: "#D1D5DB", Incomum: "#22C55E", Raro: "#3B82F6", Mitico: "#EF4444", Secreto: "#F59E0B" }[rarityKey(achievement.rarity) as "Comum" | "Incomum" | "Raro" | "Mitico" | "Secreto"] || "#D1D5DB" : undefined; return <div key={achievement.id} className={`rounded-2xl border-2 p-4 text-center shadow-lg ${unlocked ? "bg-white/90 text-gray-700" : "border-gray-300 bg-gray-200 text-gray-500 grayscale opacity-70"}`} style={accent ? { borderColor: accent } : undefined}><div className="mb-2 text-xs font-semibold uppercase tracking-[0.24em]" style={accent ? { color: accent } : undefined}>{secretLocked ? "?" : unlocked ? "Liberada" : "Bloqueada"}</div><h3 className="mb-1 text-sm font-bold" style={accent ? { color: accent } : undefined}>{secretLocked ? "?" : achievement.name}</h3><p className="text-xs opacity-90">{secretLocked ? "?" : achievement.description}</p>{unlocked && achievement.unlocked_at ? <p className="mt-2 text-xs opacity-75">{new Date(achievement.unlocked_at).toLocaleDateString()}</p> : null}</div>; })}</div> : null}{tab === "titles" ? <div className="space-y-3">{titles.map((title) => { const unlocked = title.unlocked === 1; const active = title.is_active === 1; const border = { Comum: "border-gray-400", Raro: "border-blue-500", Epico: "border-purple-500", Lendario: "border-yellow-500" }[rarityKey(title.rarity) as "Comum" | "Raro" | "Epico" | "Lendario"] || "border-gray-400"; return <div key={title.id} className={`rounded-2xl border-2 bg-white/80 p-4 shadow-lg backdrop-blur-sm ${unlocked ? border : "border-gray-200"} ${active ? "ring-2 ring-emerald-500" : ""}`}><div className="flex items-center justify-between"><div className="flex-1"><h3 className={`font-bold ${unlocked ? "text-gray-900" : "text-gray-400"}`}>{unlocked ? title.name : "Bloqueado"}</h3><p className="text-xs text-gray-500">{title.rarity}</p></div>{unlocked && !active ? <button onClick={() => { void activateTitle(title.id); }} className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600">Ativar</button> : null}{active ? <span className="rounded-lg bg-emerald-100 px-4 py-2 text-sm font-medium text-emerald-700">Ativo</span> : null}</div></div>; })}</div> : null}</div></> : <div className="mt-6 px-6 pb-6"><ProfileFriendsPanel /></div>}
      {settingsOpen ? <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center"><div className="max-h-[90vh] w-full overflow-y-auto rounded-t-3xl bg-white p-6 shadow-2xl sm:max-w-2xl sm:rounded-3xl"><div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-bold text-gray-900">Configuracoes</h2><button onClick={() => setSettingsOpen(false)} className="fl-btn-secondary rounded-lg px-3 py-1">Fechar</button></div><div className="space-y-4"><div className="rounded-2xl border border-gray-200 p-4"><h3 className="mb-3 font-semibold text-gray-900">Informacoes da conta</h3><p className="text-sm text-gray-700">Nome: {profile?.full_name ?? "-"}</p><p className="text-sm text-gray-700">Email: {user?.email ?? "-"}</p><p className="text-sm text-gray-700">Username: @{profile?.username ?? "-"}</p></div><div className="rounded-2xl border border-gray-200 p-4"><h3 className="mb-3 font-semibold text-gray-900">Foco atual</h3><div className="grid grid-cols-2 gap-2"><button onClick={() => { void updateFocus("calistenia"); }} className={`rounded-xl py-2 ${profile?.active_skill_focus === "calistenia" ? "fl-btn-primary" : "fl-btn-secondary"}`}>Foco Calistenia</button><button onClick={() => { void updateFocus("yoga"); }} className={`rounded-xl py-2 ${profile?.active_skill_focus === "yoga" ? "fl-btn-primary" : "fl-btn-secondary"}`}>Foco Yoga</button></div></div>{isMobile ? <div className="space-y-4 rounded-2xl border border-gray-200 p-4"><h3 className="font-semibold text-gray-900">Personalizacao (mobile)</h3><div className="grid grid-cols-2 gap-3"><button onClick={() => primaryColorInputRef.current?.click()} className="h-12 rounded-lg border-2 border-white/20 shadow-inner" style={{ backgroundColor: primaryColor }} type="button" aria-label="Selecionar cor primaria" /><button onClick={() => secondaryColorInputRef.current?.click()} className="h-12 rounded-lg border-2 border-white/20 shadow-inner" style={{ backgroundColor: secondaryColor }} type="button" aria-label="Selecionar cor secundaria" /></div><div className="flex justify-between text-xs text-gray-500"><span>Cor primaria</span><span>Cor secundaria</span></div><input ref={primaryColorInputRef} type="color" value={primaryColor} onChange={(event) => { void updateColor("custom_primary_color", event.target.value); }} className="sr-only" /><input ref={secondaryColorInputRef} type="color" value={secondaryColor} onChange={(event) => { void updateColor("custom_secondary_color", event.target.value); }} className="sr-only" /><select value={customFont} onChange={(event) => { void updateFont(event.target.value); }} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm" style={{ fontFamily: FONT_OPTIONS.find((font) => font.value === customFont)?.family ?? "inherit" }}>{FONT_OPTIONS.map((font) => <option key={font.value} value={font.value} style={{ fontFamily: font.family }}>{font.label}</option>)}</select><div className="grid grid-cols-2 gap-2"><button onClick={() => { void applySolidBackground(); }} className="fl-btn-secondary w-full rounded-xl py-2">Fundo solido</button><label className="fl-btn-secondary block cursor-pointer rounded-xl py-2 text-center">Escolher foto<input type="file" accept="image/*" className="hidden" onChange={pickBackgroundImage} /></label></div>{bgPreview ? <img src={bgPreview} alt="Previa do fundo" loading="lazy" decoding="async" className="h-28 w-full rounded-xl border border-gray-200 object-cover" /> : null}{customizationSaving ? <div className="flex items-center gap-2 text-xs text-gray-500"><LoadingBall size="sm" />Salvando personalizacao...</div> : null}</div> : <div className="rounded-2xl border border-gray-200 p-4 text-sm text-gray-600">Personalizacao visual disponivel apenas no mobile.</div>}<div className="space-y-3 rounded-2xl border border-gray-200 p-4"><h3 className="font-semibold text-gray-900">Enviar feedback</h3><select value={feedbackType} onChange={(event) => setFeedbackType(event.target.value as "Sugestao" | "Bug" | "Elogio" | "Outro")} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"><option value="Sugestao">Sugestao</option><option value="Bug">Bug</option><option value="Elogio">Elogio</option><option value="Outro">Outro</option></select><textarea value={feedbackMessage} onChange={(event) => setFeedbackMessage(event.target.value)} className="min-h-[110px] w-full resize-y rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm" placeholder="Escreva seu feedback aqui..." />{feedbackStatus ? <p className={`text-sm ${feedbackStatus.type === "success" ? "text-emerald-700" : "text-red-600"}`}>{feedbackStatus.message}</p> : null}<button onClick={() => { void sendFeedback(); }} disabled={feedbackSending} className="fl-btn-primary inline-flex min-w-[120px] items-center justify-center gap-2 rounded-xl px-4 py-2 disabled:opacity-70">{feedbackSending ? <LoadingBall size="sm" /> : null}{feedbackSending ? "Enviando..." : "Enviar"}</button></div></div></div></div> : null}
      <BottomNav active="profile" />
    </div>
  );
}
