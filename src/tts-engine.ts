import { spawn } from "node:child_process";
import { platform } from "node:os";
import { readFileSync } from "node:fs";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/** Supported audio output formats for TTS. */
export type AudioFormat = "mp3" | "wav" | "opus" | "aac" | "flac" | "pcm";

/** Options for synthesizing speech. */
export interface SynthesisOptions {
  /** The text to convert to speech. */
  text: string;
  /** The voice identifier to use. Engine-specific. */
  voice?: string;
  /** Desired audio format. Not all engines support all formats; unsupported formats fall back to wav. */
  format?: AudioFormat;
  /** Speech speed multiplier (1.0 = normal). Supported range varies by engine. */
  speed?: number;
}

/** Result of a TTS synthesis operation. */
export interface SynthesisResult {
  /** Raw audio bytes. */
  audio: Buffer;
  /** Actual format of the returned audio. */
  format: AudioFormat;
}

/** Describes a single voice available on the TTS engine. */
export interface VoiceInfo {
  id: string;
  name: string;
  language?: string;
  gender?: string;
}

/** Describes a TTS model available on the engine. */
export interface TtsModelInfo {
  id: string;
  owned_by: string;
}

/** Abstract base class for TTS engine implementations. */
export abstract class TtsEngine {
  abstract synthesize(opts: SynthesisOptions): Promise<SynthesisResult>;
  abstract listVoices(): Promise<VoiceInfo[]>;

  /**
   * List available TTS models.  The default implementation returns the
   * two OpenAI-compatible stub entries; engines that manage real models
   * should override this.
   */
  async listModels(): Promise<TtsModelInfo[]> {
    return [
      { id: "tts-1", owned_by: "lms-speaks" },
      { id: "tts-1-hd", owned_by: "lms-speaks" },
    ];
  }
}

// ---------------------------------------------------------------------------
// SystemTtsEngine – uses the OS built-in TTS via child_process
// ---------------------------------------------------------------------------

/**
 * Uses the operating system's built-in speech synthesis to generate audio.
 *
 * - **macOS** – `say -v <voice> -o <file.aiff> --data-format=LEF32@22050`
 * - **Windows** – PowerShell `Add-Type -AssemblyName System.Speech`
 * - **Linux** – `espeak-ng` or `espeak`
 *
 * Audio is captured to a temporary file then returned as a Buffer and cleaned up.
 */
export class SystemTtsEngine extends TtsEngine {
  private readonly os: string;

  constructor() {
    super();
    this.os = platform();
  }

  async synthesize(opts: SynthesisOptions): Promise<SynthesisResult> {
    const text = opts.text;
    const voice = opts.voice ?? "default";
    const speed = opts.speed ?? 1.0;

    const tmpFile = join(tmpdir(), `lms-speaks-${randomUUID()}`);

    try {
      if (this.os === "darwin") {
        return await this.synthesizeMac(text, voice, speed, tmpFile);
      } else if (this.os === "win32") {
        return await this.synthesizeWindows(text, voice, speed, tmpFile);
      } else {
        return await this.synthesizeLinux(text, voice, speed, tmpFile);
      }
    } finally {
      await unlink(tmpFile).catch(() => {
        // Best-effort cleanup – ignore errors if file does not exist.
      });
    }
  }

  private async synthesizeMac(
    text: string,
    voice: string,
    speed: number,
    tmpFile: string
  ): Promise<SynthesisResult> {
    const outputPath = `${tmpFile}.wav`;
    // Write text to a temp file so it is never interpolated into a command line.
    const inputFile = `${tmpFile}.txt`;
    await writeFile(inputFile, text, "utf8");

    try {
      return await new Promise((resolve, reject) => {
        const voiceArgs = voice !== "default" ? ["-v", voice] : [];
        // macOS `say` rate is words-per-minute; 200 wpm ≈ 1× speed.
        const rate = Math.round(200 * speed);
        const args = [
          ...voiceArgs,
          "-r",
          String(rate),
          "-o",
          outputPath,
          "--data-format=LEI16@22050",
          "-f",
          inputFile,
        ];
        const proc = spawn("say", args);
        proc.on("error", reject);
        proc.on("close", (code) => {
          if (code !== 0) {
            reject(new Error(`say exited with code ${code}`));
            return;
          }
          try {
            const audio = readFileSync(outputPath);
            unlink(outputPath).catch(() => {});
            resolve({ audio, format: "wav" });
          } catch (e) {
            reject(e);
          }
        });
      });
    } finally {
      await unlink(inputFile).catch(() => {});
    }
  }

  private synthesizeWindows(
    text: string,
    voice: string,
    speed: number,
    tmpFile: string
  ): Promise<SynthesisResult> {
    return new Promise((resolve, reject) => {
      const outputPath = `${tmpFile}.wav`;
      // Use a here-string variable for the text so that no user-supplied
      // characters are ever interpolated as PowerShell syntax.
      const voiceCmd =
        voice !== "default" ? `$s.SelectVoice($env:TTS_VOICE); ` : "";
      // Windows SAPI rate: –10 (slowest) to 10 (fastest); 0 = normal (≈ 150 wpm).
      const rate = Math.max(-10, Math.min(10, Math.round((speed - 1) * 5)));
      const script = [
        "Add-Type -AssemblyName System.Speech;",
        "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;",
        voiceCmd,
        `$s.Rate = ${rate};`,
        `$s.SetOutputToWaveFile($env:TTS_OUTPUT);`,
        "$s.Speak($env:TTS_INPUT);",
        "$s.Dispose();",
      ].join(" ");
      // Encode the script as UTF-16LE Base64 for -EncodedCommand to prevent
      // any injection of user-supplied text or voice into the PS command line.
      const encodedScript = Buffer.from(script, "utf16le").toString("base64");
      const proc = spawn(
        "powershell",
        ["-NoProfile", "-EncodedCommand", encodedScript],
        {
          env: {
            ...process.env,
            TTS_INPUT: text,
            TTS_OUTPUT: outputPath,
            TTS_VOICE: voice !== "default" ? voice : "",
          },
        }
      );
      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`PowerShell exited with code ${code}`));
          return;
        }
        try {
          const audio = readFileSync(outputPath);
          unlink(outputPath).catch(() => {});
          resolve({ audio, format: "wav" });
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  private async synthesizeLinux(
    text: string,
    voice: string,
    speed: number,
    tmpFile: string
  ): Promise<SynthesisResult> {
    const outputPath = `${tmpFile}.wav`;
    // Write text to a temp input file to avoid shell injection.
    const inputFile = `${tmpFile}.txt`;
    await writeFile(inputFile, text, "utf8");

    try {
      return await new Promise((resolve, reject) => {
        const voiceArgs =
          voice !== "default" ? ["-v", voice] : [];
        // espeak-ng speed in words per minute; 175 wpm ≈ 1× speed.
        const rate = Math.round(175 * speed);
        const args = [
          ...voiceArgs,
          "-s",
          String(rate),
          "-w",
          outputPath,
          "-f",
          inputFile,
        ];

        // Use a flag so that only one resolution path executes even if
        // both the "error" and "close" events fire for the same process.
        let eventHandled = false;

        const readResult = () => {
          try {
            const audio = readFileSync(outputPath);
            unlink(outputPath).catch(() => {});
            resolve({ audio, format: "wav" });
          } catch (e) {
            reject(e);
          }
        };

        const runFallback = () => {
          // espeak-ng not found – try plain espeak.
          const fallback = spawn("espeak", args);
          const fstderr: Buffer[] = [];
          fallback.stderr.on("data", (d: Buffer) => fstderr.push(d));
          fallback.on("error", reject);
          fallback.on("close", (code) => {
            if (code !== 0) {
              reject(
                new Error(
                  `espeak exited with code ${code}: ${Buffer.concat(fstderr).toString()}`
                )
              );
              return;
            }
            readResult();
          });
        };

        // Prefer espeak-ng; fall back to espeak.
        const proc = spawn("espeak-ng", args);
        const stderr: Buffer[] = [];
        proc.stderr.on("data", (d: Buffer) => stderr.push(d));
        proc.on("error", (err) => {
          if (eventHandled) return;
          eventHandled = true;
          if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            runFallback();
          } else {
            reject(err);
          }
        });
        proc.on("close", (code) => {
          if (eventHandled) return;
          eventHandled = true;
          if (code !== 0) {
            reject(
              new Error(
                `espeak-ng exited with code ${code}: ${Buffer.concat(stderr).toString()}`
              )
            );
            return;
          }
          readResult();
        });
      });
    } finally {
      await unlink(inputFile).catch(() => {});
    }
  }

  async listVoices(): Promise<VoiceInfo[]> {
    if (this.os === "darwin") {
      return this.listVoicesMac();
    } else if (this.os === "win32") {
      return this.listVoicesWindows();
    } else {
      return this.listVoicesLinux();
    }
  }

  private listVoicesMac(): Promise<VoiceInfo[]> {
    return new Promise((resolve) => {
      const proc = spawn("say", ["-v", "?"]);
      const chunks: Buffer[] = [];
      proc.stdout.on("data", (d: Buffer) => chunks.push(d));
      proc.on("close", () => {
        const output = Buffer.concat(chunks).toString("utf8");
        const voices: VoiceInfo[] = output
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            // Format: "Alex               en_US    # Most people recognise me by my voice."
            const match = line.match(/^(\S+)\s+(\S+)/);
            if (!match) return null;
            const [, name, lang] = match;
            const language = lang?.replace("_", "-");
            return { id: name, name, language } as VoiceInfo;
          })
          .filter((v): v is NonNullable<typeof v> => v !== null);
        resolve(voices.length ? voices : [{ id: "default", name: "Default" }]);
      });
      proc.on("error", () =>
        resolve([{ id: "default", name: "Default (macOS)" }])
      );
    });
  }

  private listVoicesWindows(): Promise<VoiceInfo[]> {
    return new Promise((resolve) => {
      const script =
        "Add-Type -AssemblyName System.Speech; " +
        "(New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | " +
        "ForEach-Object { $_.VoiceInfo.Name + '|' + $_.VoiceInfo.Culture + '|' + $_.VoiceInfo.Gender }";
      const proc = spawn("powershell", ["-NoProfile", "-Command", script]);
      const chunks: Buffer[] = [];
      proc.stdout.on("data", (d: Buffer) => chunks.push(d));
      proc.on("close", () => {
        const output = Buffer.concat(chunks).toString("utf8");
        const voices: VoiceInfo[] = output
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            const [name, lang, gender] = line.trim().split("|");
            if (!name) return null;
            return {
              id: name,
              name,
              language: lang,
              gender: gender?.toLowerCase(),
            } as VoiceInfo;
          })
          .filter((v): v is NonNullable<typeof v> => v !== null);
        resolve(voices.length ? voices : [{ id: "default", name: "Default" }]);
      });
      proc.on("error", () =>
        resolve([{ id: "default", name: "Default (Windows)" }])
      );
    });
  }

  private listVoicesLinux(): Promise<VoiceInfo[]> {
    return new Promise((resolve) => {
      const proc = spawn("espeak-ng", ["--voices"]);
      const chunks: Buffer[] = [];
      // Use a flag to ensure resolve() is called at most once even when
      // both the "error" and "close" events fire for the same process.
      let eventHandled = false;
      proc.stdout.on("data", (d: Buffer) => chunks.push(d));
      proc.on("error", () => {
        if (eventHandled) return;
        eventHandled = true;
        // Try plain espeak as fallback.
        const proc2 = spawn("espeak", ["--voices"]);
        const chunks2: Buffer[] = [];
        proc2.stdout.on("data", (d: Buffer) => chunks2.push(d));
        proc2.on("close", () => parseEspeakVoices(chunks2, resolve));
        proc2.on("error", () =>
          resolve([{ id: "default", name: "Default (Linux)" }])
        );
      });
      proc.on("close", () => {
        if (eventHandled) return;
        eventHandled = true;
        parseEspeakVoices(chunks, resolve);
      });
    });

    function parseEspeakVoices(
      chunks: Buffer[],
      resolve: (v: VoiceInfo[]) => void
    ) {
      const output = Buffer.concat(chunks).toString("utf8");
      const voices: VoiceInfo[] = output
        .split("\n")
        .slice(1) // skip header
        .filter(Boolean)
        .map((line) => {
          // Format: " 5  en             en/en          (en 7)"
          const parts = line.trim().split(/\s+/);
          if (parts.length < 3) return null;
          const lang = parts[1] ?? "";
          const name = parts[2] ?? lang;
          return { id: name, name, language: lang } as VoiceInfo;
        })
        .filter((v): v is NonNullable<typeof v> => v !== null);
      resolve(voices.length ? voices : [{ id: "default", name: "Default" }]);
    }
  }
}

// ---------------------------------------------------------------------------
// LmStudioTtsEngine – delegates synthesis to a TTS model loaded in LM Studio
// ---------------------------------------------------------------------------

/** Options for constructing an {@link LmStudioTtsEngine}. */
export interface LmStudioTtsEngineOptions {
  /**
   * An {@link LMStudioClient} instance used to discover and load TTS models.
   * When omitted the engine operates in "API-only" mode – it still forwards
   * synthesis requests to the LM Studio HTTP server but cannot list or
   * auto-load models.
   */
  client?: import("@lmstudio/sdk").LMStudioClient;

  /**
   * Base URL of the LM Studio HTTP API server.
   * Default: `http://127.0.0.1:1234`
   */
  apiBaseUrl?: string;

  /**
   * The model key (path) of the TTS model to load / use.  When a
   * {@link client} is provided and the model is not yet loaded, the engine
   * will attempt to load it on first use.
   */
  modelKey?: string;
}

/**
 * Uses a TTS model loaded in LM Studio to generate speech.
 *
 * The engine talks to the LM Studio HTTP API server's OpenAI-compatible
 * `/v1/audio/speech` endpoint.  When an {@link LMStudioClient} is provided
 * the engine can additionally list downloaded TTS models and auto-load a
 * model before the first synthesis request.
 */
export class LmStudioTtsEngine extends TtsEngine {
  private readonly apiBaseUrl: string;
  private readonly client?: import("@lmstudio/sdk").LMStudioClient;
  private readonly modelKey?: string;
  private modelLoaded = false;

  constructor(opts: LmStudioTtsEngineOptions = {}) {
    super();
    this.apiBaseUrl = (opts.apiBaseUrl ?? "http://127.0.0.1:1234").replace(
      /\/$/,
      ""
    );
    this.client = opts.client;
    this.modelKey = opts.modelKey;
  }

  /**
   * Ensure the configured TTS model is loaded in LM Studio.
   * If no client or modelKey was provided, this is a no-op.
   */
  private async ensureModelLoaded(): Promise<void> {
    if (this.modelLoaded || !this.client || !this.modelKey) {
      return;
    }
    try {
      // Check whether the model is already loaded.
      const loaded = await this.client.llm.listLoaded();
      const alreadyLoaded = loaded.some(
        (m) => m.path === this.modelKey || m.identifier === this.modelKey
      );
      if (!alreadyLoaded) {
        await this.client.llm.load(this.modelKey, { verbose: true });
      }
      this.modelLoaded = true;
    } catch {
      // If model loading fails we still allow the synthesis attempt –
      // the LM Studio server may have the model loaded externally.
    }
  }

  async synthesize(opts: SynthesisOptions): Promise<SynthesisResult> {
    await this.ensureModelLoaded();

    const format = opts.format ?? "wav";
    const body: Record<string, unknown> = {
      input: opts.text,
      response_format: format,
    };
    if (this.modelKey) {
      body.model = this.modelKey;
    }
    if (opts.voice) {
      body.voice = opts.voice;
    }
    if (opts.speed !== undefined) {
      body.speed = opts.speed;
    }

    const res = await fetch(`${this.apiBaseUrl}/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      let detail: string;
      try {
        const json = (await res.json()) as { error?: { message?: string } };
        detail = json?.error?.message ?? res.statusText;
      } catch {
        detail = res.statusText;
      }
      throw new Error(
        `LM Studio TTS request failed (${res.status}): ${detail}`
      );
    }

    const audio = Buffer.from(await res.arrayBuffer());
    return { audio, format };
  }

  async listVoices(): Promise<VoiceInfo[]> {
    // LM Studio TTS models typically do not expose a per-voice list.
    // Return a sensible default so callers have at least one entry.
    return [{ id: "default", name: "Default" }];
  }

  /**
   * List TTS models that are downloaded in LM Studio.
   * Falls back to querying the LM Studio API `/v1/models` endpoint when no
   * SDK client is available.
   */
  override async listModels(): Promise<TtsModelInfo[]> {
    // ── SDK path: filter downloaded models by the "tts" domain ──────
    if (this.client) {
      try {
        const all = await this.client.system.listDownloadedModels();
        // ModelInfo doesn't expose a `domain` field in the public types
        // but the underlying data may contain one.  Cast to access it.
        const ttsModels = all.filter(
          (m) => (m as unknown as { domain?: string }).domain === "tts"
        );
        if (ttsModels.length > 0) {
          return ttsModels.map((m) => ({
            id: m.modelKey,
            owned_by: "lmstudio",
          }));
        }
        // If domain-based filtering yielded nothing, return all downloaded
        // models so the user can still pick one.
        return all.map((m) => ({
          id: m.modelKey,
          owned_by: "lmstudio",
        }));
      } catch {
        // Fall through to HTTP approach.
      }
    }

    // ── HTTP fallback: query LM Studio's /v1/models endpoint ────────
    try {
      const res = await fetch(`${this.apiBaseUrl}/v1/models`);
      if (res.ok) {
        const json = (await res.json()) as {
          data?: Array<{ id: string; owned_by?: string }>;
        };
        if (json.data && json.data.length > 0) {
          return json.data.map((m) => ({
            id: m.id,
            owned_by: m.owned_by ?? "lmstudio",
          }));
        }
      }
    } catch {
      // LM Studio server may not be running yet.
    }

    return [];
  }
}
