export type LLMProvider = "google" | "openai";

type GoogleModel =
  | "gemini-2.5-flash"
  | "gemini-2.5-flash-image"
  | "gemini-2.5-flash-lite"
  | "gemini-2.5-flash-lite-preview-09-2025"
  | "gemini-2.5-flash-native-audio-preview-12-2025"
  | "gemini-2.5-flash-preview-09-2025"
  | "gemini-2.5-flash-preview-tts"
  | "gemini-2.5-pro"
  | "gemini-2.5-pro-preview-tts"
  | "gemini-3-flash-preview"
  | "gemini-3-pro-image-preview"
  | "gemini-3-pro-preview"
  | "gemini-3.1-pro-preview"
  | "gemini-3.1-flash-image-preview";

type OpenAIChatModel =
  | "gpt-5.4"
  | "gpt-5.4-mini"
  | "gpt-5.4-nano"
  | "gpt-5.4-mini-2026-03-17"
  | "gpt-5.4-nano-2026-03-17"
  | "gpt-5.3-chat-latest"
  | "gpt-5.2"
  | "gpt-5.2-2025-12-11"
  | "gpt-5.2-chat-latest"
  | "gpt-5.2-pro"
  | "gpt-5.2-pro-2025-12-11"
  | "gpt-5.1"
  | "gpt-5.1-2025-11-13"
  | "gpt-5.1-codex"
  | "gpt-5.1-mini"
  | "gpt-5.1-chat-latest"
  | "gpt-5"
  | "gpt-5-mini"
  | "gpt-5-nano"
  | "gpt-5-2025-08-07"
  | "gpt-5-mini-2025-08-07"
  | "gpt-5-nano-2025-08-07"
  | "gpt-5-chat-latest"
  | "gpt-4.1"
  | "gpt-4.1-mini"
  | "gpt-4.1-nano"
  | "gpt-4.1-2025-04-14"
  | "gpt-4.1-mini-2025-04-14"
  | "gpt-4.1-nano-2025-04-14"
  | "o4-mini"
  | "o4-mini-2025-04-16"
  | "o3"
  | "o3-2025-04-16"
  | "o3-mini"
  | "o3-mini-2025-01-31"
  | "o1"
  | "o1-2024-12-17"
  | "o1-preview"
  | "o1-preview-2024-09-12"
  | "o1-mini"
  | "o1-mini-2024-09-12"
  | "gpt-4o"
  | "gpt-4o-2024-11-20"
  | "gpt-4o-2024-08-06"
  | "gpt-4o-2024-05-13"
  | "gpt-4o-audio-preview"
  | "gpt-4o-audio-preview-2024-10-01"
  | "gpt-4o-audio-preview-2024-12-17"
  | "gpt-4o-audio-preview-2025-06-03"
  | "gpt-4o-mini-audio-preview"
  | "gpt-4o-mini-audio-preview-2024-12-17"
  | "gpt-4o-search-preview"
  | "gpt-4o-mini-search-preview"
  | "gpt-4o-search-preview-2025-03-11"
  | "gpt-4o-mini-search-preview-2025-03-11"
  | "chatgpt-4o-latest"
  | "codex-mini-latest"
  | "gpt-4o-mini"
  | "gpt-4o-mini-2024-07-18"
  | "gpt-4-turbo"
  | "gpt-4-turbo-2024-04-09"
  | "gpt-4-0125-preview"
  | "gpt-4-turbo-preview"
  | "gpt-4-1106-preview"
  | "gpt-4-vision-preview"
  | "gpt-4"
  | "gpt-4-0314"
  | "gpt-4-0613"
  | "gpt-4-32k"
  | "gpt-4-32k-0314"
  | "gpt-4-32k-0613"
  | "gpt-3.5-turbo"
  | "gpt-3.5-turbo-16k"
  | "gpt-3.5-turbo-0301"
  | "gpt-3.5-turbo-0613"
  | "gpt-3.5-turbo-1106"
  | "gpt-3.5-turbo-0125"
  | "gpt-3.5-turbo-16k-0613";

export type SavedLLMConfig = {
  provider: LLMProvider | "";
  model: string;
  token: string;
};

export const LLM_CONFIG_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export const LLM_CONFIG_COOKIE_NAMES = {
  provider: "atlas.llm.provider",
  model: "atlas.llm.model",
  token: "atlas.llm.token",
} as const;

export const LLM_DEFAULT_MODELS: Record<LLMProvider, string> = {
  google: "gemini-2.5-flash",
  openai: "gpt-4.1-mini",
};

export const GOOGLE_CHAT_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-image",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash-lite-preview-09-2025",
  "gemini-2.5-flash-native-audio-preview-12-2025",
  "gemini-2.5-flash-preview-09-2025",
  "gemini-2.5-flash-preview-tts",
  "gemini-2.5-pro",
  "gemini-2.5-pro-preview-tts",
  "gemini-3-flash-preview",
  "gemini-3-pro-image-preview",
  "gemini-3-pro-preview",
  "gemini-3.1-pro-preview",
  "gemini-3.1-flash-image-preview",
] as const satisfies ReadonlyArray<GoogleModel>;

export const OPENAI_CHAT_MODELS = [
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.4-nano",
  "gpt-5.4-mini-2026-03-17",
  "gpt-5.4-nano-2026-03-17",
  "gpt-5.3-chat-latest",
  "gpt-5.2",
  "gpt-5.2-2025-12-11",
  "gpt-5.2-chat-latest",
  "gpt-5.2-pro",
  "gpt-5.2-pro-2025-12-11",
  "gpt-5.1",
  "gpt-5.1-2025-11-13",
  "gpt-5.1-codex",
  "gpt-5.1-mini",
  "gpt-5.1-chat-latest",
  "gpt-5",
  "gpt-5-mini",
  "gpt-5-nano",
  "gpt-5-2025-08-07",
  "gpt-5-mini-2025-08-07",
  "gpt-5-nano-2025-08-07",
  "gpt-5-chat-latest",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  "gpt-4.1-2025-04-14",
  "gpt-4.1-mini-2025-04-14",
  "gpt-4.1-nano-2025-04-14",
  "o4-mini",
  "o4-mini-2025-04-16",
  "o3",
  "o3-2025-04-16",
  "o3-mini",
  "o3-mini-2025-01-31",
  "o1",
  "o1-2024-12-17",
  "o1-preview",
  "o1-preview-2024-09-12",
  "o1-mini",
  "o1-mini-2024-09-12",
  "gpt-4o",
  "gpt-4o-2024-11-20",
  "gpt-4o-2024-08-06",
  "gpt-4o-2024-05-13",
  "gpt-4o-audio-preview",
  "gpt-4o-audio-preview-2024-10-01",
  "gpt-4o-audio-preview-2024-12-17",
  "gpt-4o-audio-preview-2025-06-03",
  "gpt-4o-mini-audio-preview",
  "gpt-4o-mini-audio-preview-2024-12-17",
  "gpt-4o-search-preview",
  "gpt-4o-mini-search-preview",
  "gpt-4o-search-preview-2025-03-11",
  "gpt-4o-mini-search-preview-2025-03-11",
  "chatgpt-4o-latest",
  "codex-mini-latest",
  "gpt-4o-mini",
  "gpt-4o-mini-2024-07-18",
  "gpt-4-turbo",
  "gpt-4-turbo-2024-04-09",
  "gpt-4-0125-preview",
  "gpt-4-turbo-preview",
  "gpt-4-1106-preview",
  "gpt-4-vision-preview",
  "gpt-4",
  "gpt-4-0314",
  "gpt-4-0613",
  "gpt-4-32k",
  "gpt-4-32k-0314",
  "gpt-4-32k-0613",
  "gpt-3.5-turbo",
  "gpt-3.5-turbo-16k",
  "gpt-3.5-turbo-0301",
  "gpt-3.5-turbo-0613",
  "gpt-3.5-turbo-1106",
  "gpt-3.5-turbo-0125",
  "gpt-3.5-turbo-16k-0613",
] as const satisfies ReadonlyArray<OpenAIChatModel>;

export const LLM_MODELS_BY_PROVIDER: Record<LLMProvider, ReadonlyArray<string>> = {
  google: GOOGLE_CHAT_MODELS,
  openai: OPENAI_CHAT_MODELS,
};

export function isLLMProvider(value: string): value is LLMProvider {
  return value === "google" || value === "openai";
}

export function getCookie(name: string) {
  if (typeof document === "undefined") return "";

  const prefix = `${name}=`;
  for (const part of document.cookie.split(";")) {
    const cookie = part.trim();
    if (!cookie.startsWith(prefix)) continue;
    return decodeURIComponent(cookie.slice(prefix.length));
  }

  return "";
}

export function setCookie(name: string, value: string, maxAge = LLM_CONFIG_COOKIE_MAX_AGE) {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; samesite=lax`;
}

export function loadSavedLlmConfig(): SavedLLMConfig {
  const rawProvider = getCookie(LLM_CONFIG_COOKIE_NAMES.provider);
  const provider = isLLMProvider(rawProvider) ? rawProvider : "";

  return {
    provider,
    model: getCookie(LLM_CONFIG_COOKIE_NAMES.model),
    token: getCookie(LLM_CONFIG_COOKIE_NAMES.token),
  };
}

export function saveLlmConfig(config: { provider: LLMProvider; model: string; token: string }) {
  setCookie(LLM_CONFIG_COOKIE_NAMES.provider, config.provider);
  setCookie(LLM_CONFIG_COOKIE_NAMES.model, config.model);
  setCookie(LLM_CONFIG_COOKIE_NAMES.token, config.token);
}

export function hasCompleteLlmConfig(config: SavedLLMConfig): config is {
  provider: LLMProvider;
  model: string;
  token: string;
} {
  return isLLMProvider(config.provider) && !!config.model.trim() && !!config.token.trim();
}

export function createEditableLlmConfig(config: SavedLLMConfig) {
  const provider = config.provider || "google";
  const providerModels = LLM_MODELS_BY_PROVIDER[provider];
  const model =
    config.model && providerModels.includes(config.model)
      ? config.model
      : LLM_DEFAULT_MODELS[provider];

  return {
    provider,
    model,
    token: config.token,
  };
}
