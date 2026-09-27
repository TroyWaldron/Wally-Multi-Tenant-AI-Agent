// Speech to text for voice notes. Uses OpenAI's Whisper through the platform
// OPENAI_API_KEY (or a business's own key). The audio is never stored: only
// the text goes on into the chat, where it is treated like a typed message
// (PII redaction included). Minutes are metered as voice_stt usage.
import { getConfig } from "@/lib/settings";
import type { Store } from "@/lib/store/types";

export const MAX_AUDIO_BYTES = 8 * 1024 * 1024; // about 2 minutes of speech
const USD_PER_MINUTE = 0.006;

export async function voiceKey(tenantId: string) {
  return getConfig(tenantId, "OPENAI_API_KEY");
}

export async function transcribe(store: Store, tenantId: string, audio: Blob, agentId: string | null): Promise<string> {
  const key = await voiceKey(tenantId);
  if (!key) throw new Error("Voice notes are not switched on.");
  const form = new FormData();
  const type = audio.type || "audio/webm";
  const ext = type.includes("mp4") ? "mp4" : type.includes("ogg") ? "ogg" : type.includes("mpeg") ? "mp3" : type.includes("wav") ? "wav" : "webm";
  form.append("file", audio, `note.${ext}`);
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) {
    console.error("transcription failed", res.status, (await res.text().catch(() => "")).slice(0, 300));
    throw new Error("Sorry, I couldn't hear that. Please try again or type your message.");
  }
  const d = (await res.json()) as { text?: string; duration?: number };
  const minutes = Math.max(0.1, (d.duration ?? 0) / 60);
  await store.recordUsage(tenantId, { agentId, kind: "voice_stt", model: "whisper-1", inputTokens: 0, outputTokens: 0, minutes, costUsd: minutes * USD_PER_MINUTE });
  return (d.text ?? "").trim();
}
