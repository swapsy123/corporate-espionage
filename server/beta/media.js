import { IntegrationError } from "./providers.js";
export async function transcribeMedia(
  bytes,
  mime,
  { apiKey = process.env.LEVR_AI_API_KEY, fetchImpl = fetch } = {},
) {
  if (!apiKey)
    throw new IntegrationError(
      "Configure the paid beta AI key before transcribing media.",
      503,
    );
  const form = new FormData();
  const ext = {
    "video/mp4": "mp4",
    "video/webm": "webm",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/mp4": "m4a",
  }[mime];
  if (!ext)
    throw new IntegrationError("Use an MP4, WebM, MP3, WAV or M4A file.", 400);
  form.set("file", new Blob([bytes], { type: mime }), `source.${ext}`);
  form.set("model", "whisper-1");
  form.set("response_format", "verbose_json");
  let r;
  try {
    r = await fetchImpl("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      redirect: "error",
      signal: AbortSignal.timeout(120000),
    });
  } catch {
    throw new IntegrationError(
      "Transcription timed out. The original upload remains saved.",
    );
  }
  if (!r.ok)
    throw new IntegrationError(
      "Transcription failed. Check the AI account, file format and credits. Original media is preserved.",
    );
  const data = await r.json();
  if (typeof data.text !== "string")
    throw new IntegrationError(
      "No readable transcript was returned. Original media is preserved.",
    );
  return {
    transcript: data.text,
    segments: data.segments || [],
    duration: data.duration,
  };
}
