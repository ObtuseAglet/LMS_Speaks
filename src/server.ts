import express, { type Request, type Response } from "express";
import type { Server } from "node:http";
import type { TtsEngine } from "./tts-engine.js";

/** Supported audio formats accepted by the `/v1/audio/speech` endpoint. */
const SUPPORTED_FORMATS = new Set([
  "mp3",
  "opus",
  "aac",
  "flac",
  "wav",
  "pcm",
]);

/** Minimum / maximum speech speed accepted by the endpoint (mirrors OpenAI). */
const MIN_SPEED = 0.25;
const MAX_SPEED = 4.0;

/** MIME types for each audio format. */
const MIME_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  opus: "audio/ogg; codecs=opus",
  aac: "audio/aac",
  flac: "audio/flac",
  wav: "audio/wav",
  pcm: "audio/pcm",
};

export interface TtsServerOptions {
  /** The TTS engine implementation to use for synthesis. */
  engine: TtsEngine;
  /** TCP port to listen on (default: 8880). */
  port?: number;
  /**
   * Host/IP address to bind to (default: "127.0.0.1").
   *
   * **Security note**: The default binds only to loopback. Setting this to
   * "0.0.0.0" exposes the server on all interfaces; only do this on a
   * trusted network.
   */
  host?: string;
  /** Default voice name when the caller does not provide one. */
  defaultVoice?: string;
  /**
   * Maximum number of synthesis requests processed concurrently (default: 5).
   * Requests arriving while the limit is reached receive a 429 response.
   */
  maxConcurrency?: number;
  /** Optional logger; defaults to console. */
  logger?: Pick<Console, "info" | "warn" | "error">;
}

/**
 * Lightweight Express HTTP server that exposes OpenAI-compatible TTS endpoints.
 *
 * Endpoints
 * ---------
 * - `POST /v1/audio/speech`  – synthesize speech from text (OpenAI-compatible)
 * - `GET  /v1/audio/voices`  – list available voices (common LLM environment extension)
 * - `GET  /v1/models`        – list available TTS models (OpenAI-compatible subset)
 * - `GET  /health`           – simple liveness probe
 */
export class TtsServer {
  private readonly app: ReturnType<typeof express>;
  private server: Server | null = null;
  private readonly engine: TtsEngine;
  private readonly port: number;
  private readonly host: string;
  private readonly defaultVoice: string;
  private readonly maxConcurrency: number;
  private activeSynthesisCount = 0;
  private readonly log: Pick<Console, "info" | "warn" | "error">;

  constructor(opts: TtsServerOptions) {
    this.engine = opts.engine;
    this.port = opts.port ?? 8880;
    this.host = opts.host ?? "127.0.0.1";
    this.defaultVoice = opts.defaultVoice ?? "default";
    this.maxConcurrency = opts.maxConcurrency ?? 5;
    this.log = opts.logger ?? console;
    this.app = express();
    this.registerMiddleware();
    this.registerRoutes();
  }

  private registerMiddleware(): void {
    this.app.use(express.json({ limit: "10mb" }));
  }

  private registerRoutes(): void {
    // -----------------------------------------------------------------------
    // POST /v1/audio/speech
    // OpenAI-compatible endpoint: https://platform.openai.com/docs/api-reference/audio/createSpeech
    // -----------------------------------------------------------------------
    this.app.post(
      "/v1/audio/speech",
      async (req: Request, res: Response): Promise<void> => {
        const {
          model,
          input,
          voice,
          response_format,
          speed,
        } = req.body as {
          model?: string;
          input?: string;
          voice?: string;
          response_format?: string;
          speed?: number;
        };

        // Validate required fields.
        if (typeof input !== "string" || input.trim() === "") {
          res.status(400).json({
            error: {
              message: "Missing or empty required field: 'input'.",
              type: "invalid_request_error",
              param: "input",
              code: null,
            },
          });
          return;
        }

        if (input.length > 4096) {
          res.status(400).json({
            error: {
              message: "Field 'input' exceeds maximum length of 4096 characters.",
              type: "invalid_request_error",
              param: "input",
              code: null,
            },
          });
          return;
        }

        // Warn callers that the model parameter has no effect; the system TTS
        // engine uses a fixed OS voice and does not differentiate between
        // tts-1 and tts-1-hd quality tiers.
        if (model !== undefined && model !== null) {
          this.log.warn(
            `[TTS] 'model' parameter "${model}" is accepted but currently ignored; ` +
              "the system TTS engine uses its OS-default configuration."
          );
        }

        // The system TTS engine always returns WAV audio regardless of the
        // requested response_format.  The MIME type in the response reflects
        // the actual format returned by the engine, not the requested one.
        if (
          typeof response_format === "string" &&
          response_format !== "wav" &&
          SUPPORTED_FORMATS.has(response_format)
        ) {
          this.log.warn(
            `[TTS] response_format="${response_format}" requested, but the system TTS engine ` +
              "only produces WAV audio. Returning WAV."
          );
        }

        const format =
          typeof response_format === "string" &&
          SUPPORTED_FORMATS.has(response_format)
            ? response_format
            : "wav";

        const parsedSpeed =
          typeof speed === "number"
            ? Math.max(MIN_SPEED, Math.min(MAX_SPEED, speed))
            : 1.0;

        const resolvedVoice =
          typeof voice === "string" && voice.trim() !== ""
            ? voice.trim()
            : this.defaultVoice;

        // Concurrency guard – prevent resource exhaustion from many parallel
        // TTS requests (each spawns an OS process and writes a temp file).
        if (this.activeSynthesisCount >= this.maxConcurrency) {
          res.status(429).json({
            error: {
              message:
                `Too many concurrent synthesis requests (max ${this.maxConcurrency}). ` +
                "Please retry after a moment.",
              type: "rate_limit_error",
              param: null,
              code: null,
            },
          });
          return;
        }

        this.log.info(
          `[TTS] Synthesizing ${input.length} chars via voice="${resolvedVoice}" format=${format} speed=${parsedSpeed}`
        );

        this.activeSynthesisCount++;
        try {
          const result = await this.engine.synthesize({
            text: input,
            voice: resolvedVoice,
            format: format as import("./tts-engine.js").AudioFormat,
            speed: parsedSpeed,
          });

          const mimeType =
            MIME_TYPES[result.format] ?? "application/octet-stream";
          res.set("Content-Type", mimeType);
          res.send(result.audio);
        } catch (err) {
          this.log.error("[TTS] Synthesis error:", err);
          res.status(500).json({
            error: {
              message:
                err instanceof Error
                  ? err.message
                  : "TTS synthesis failed.",
              type: "server_error",
              param: null,
              code: null,
            },
          });
        } finally {
          this.activeSynthesisCount--;
        }
      }
    );

    // -----------------------------------------------------------------------
    // GET /v1/audio/voices
    // Common LLM environment extension to list available voices.
    // -----------------------------------------------------------------------
    this.app.get(
      "/v1/audio/voices",
      async (_req: Request, res: Response): Promise<void> => {
        try {
          const voices = await this.engine.listVoices();
          res.json({ voices });
        } catch (err) {
          this.log.error("[TTS] listVoices error:", err);
          res.status(500).json({
            error: {
              message:
                err instanceof Error
                  ? err.message
                  : "Failed to list voices.",
              type: "server_error",
              param: null,
              code: null,
            },
          });
        }
      }
    );

    // -----------------------------------------------------------------------
    // GET /v1/models
    // Returns a minimal OpenAI-compatible model list with TTS model entries.
    // -----------------------------------------------------------------------
    this.app.get(
      "/v1/models",
      async (_req: Request, res: Response): Promise<void> => {
        try {
          const models = await this.engine.listModels();
          res.json({
            object: "list",
            data: models.map((m) => ({
              id: m.id,
              object: "model",
              created: 1699000000,
              owned_by: m.owned_by,
            })),
          });
        } catch (err) {
          this.log.error("[TTS] listModels error:", err);
          res.json({
            object: "list",
            data: [
              {
                id: "tts-1",
                object: "model",
                created: 1699000000,
                owned_by: "lms-speaks",
              },
              {
                id: "tts-1-hd",
                object: "model",
                created: 1699000000,
                owned_by: "lms-speaks",
              },
            ],
          });
        }
      }
    );

    // -----------------------------------------------------------------------
    // GET /health
    // Simple liveness probe used by health-checkers and orchestration tools.
    // -----------------------------------------------------------------------
    this.app.get("/health", (_req: Request, res: Response): void => {
      res.json({ status: "ok" });
    });
  }

  /** Start the HTTP server and begin accepting connections. */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.port, this.host, () => {
        this.log.info(
          `[TTS] Server listening on http://${this.host}:${this.port}`
        );
        resolve();
      });
      this.server.on("error", reject);
    });
  }

  /** Gracefully stop the HTTP server. */
  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close((err) => {
        if (err) {
          reject(err);
        } else {
          this.log.info("[TTS] Server stopped.");
          resolve();
        }
      });
    });
  }
}
