/**
 * Tests for the TTS HTTP server.
 *
 * These tests use Node's built-in test runner (available from Node 18+).
 * They spin up a real TtsServer instance with a mock TTS engine so they do
 * not require any OS speech tools to be installed.
 *
 * Run with:
 *   npm test
 * or:
 *   node --test dist/server.test.js
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { TtsEngine, SynthesisOptions, SynthesisResult, VoiceInfo } from "./tts-engine.js";
import { TtsServer } from "./server.js";
// ---------------------------------------------------------------------------
// Mock engine
// ---------------------------------------------------------------------------

const FAKE_AUDIO = Buffer.from("FAKE_AUDIO_DATA");

class MockTtsEngine implements TtsEngine {
  async synthesize(opts: SynthesisOptions): Promise<SynthesisResult> {
    if (opts.text === "FAIL") {
      throw new Error("Simulated synthesis failure");
    }
    return { audio: FAKE_AUDIO, format: "wav" };
  }

  async listVoices(): Promise<VoiceInfo[]> {
    return [
      { id: "voice-a", name: "Voice A", language: "en-US" },
      { id: "voice-b", name: "Voice B", language: "fr-FR", gender: "female" },
    ];
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_URL = "http://127.0.0.1:18880";

async function jsonPost(
  path: string,
  body: unknown
): Promise<{ status: number; body: unknown; headers: Headers }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let parsed: unknown;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    parsed = await res.json();
  } else {
    parsed = await res.arrayBuffer();
  }
  return { status: res.status, body: parsed, headers: res.headers };
}

async function jsonGet(
  path: string
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE_URL}${path}`);
  return { status: res.status, body: await res.json() };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("TtsServer", () => {
  let server: TtsServer;

  before(async () => {
    server = new TtsServer({
      engine: new MockTtsEngine(),
      port: 18880,
      defaultVoice: "voice-a",
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    });
    await server.start();
  });

  after(async () => {
    await server.stop();
  });

  // -------------------------------------------------------------------------
  // /health
  // -------------------------------------------------------------------------
  describe("GET /health", () => {
    it("returns 200 with status ok", async () => {
      const { status, body } = await jsonGet("/health");
      assert.equal(status, 200);
      assert.deepEqual(body, { status: "ok" });
    });
  });

  // -------------------------------------------------------------------------
  // GET /v1/models
  // -------------------------------------------------------------------------
  describe("GET /v1/models", () => {
    it("returns the TTS model list", async () => {
      const { status, body } = await jsonGet("/v1/models");
      assert.equal(status, 200);
      const b = body as { object: string; data: Array<{ id: string }> };
      assert.equal(b.object, "list");
      assert.ok(b.data.some((m) => m.id === "tts-1"));
      assert.ok(b.data.some((m) => m.id === "tts-1-hd"));
    });
  });

  // -------------------------------------------------------------------------
  // GET /v1/audio/voices
  // -------------------------------------------------------------------------
  describe("GET /v1/audio/voices", () => {
    it("returns the voice list from the engine", async () => {
      const { status, body } = await jsonGet("/v1/audio/voices");
      assert.equal(status, 200);
      const b = body as { voices: Array<{ id: string }> };
      assert.equal(b.voices.length, 2);
      assert.ok(b.voices.some((v) => v.id === "voice-a"));
      assert.ok(b.voices.some((v) => v.id === "voice-b"));
    });
  });

  // -------------------------------------------------------------------------
  // POST /v1/audio/speech – success paths
  // -------------------------------------------------------------------------
  describe("POST /v1/audio/speech", () => {
    it("returns audio bytes for valid input", async () => {
      const res = await fetch(`${BASE_URL}/v1/audio/speech`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "tts-1", input: "Hello world" }),
      });
      assert.equal(res.status, 200);
      const buf = Buffer.from(await res.arrayBuffer());
      assert.deepEqual(buf, FAKE_AUDIO);
    });

    it("sets Content-Type to audio/wav by default", async () => {
      const res = await fetch(`${BASE_URL}/v1/audio/speech`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: "Hi" }),
      });
      assert.equal(res.status, 200);
      assert.ok(res.headers.get("content-type")?.includes("audio/wav"));
    });

    it("accepts voice and speed parameters without error", async () => {
      const { status } = await jsonPost("/v1/audio/speech", {
        input: "Test",
        voice: "voice-b",
        speed: 1.5,
        response_format: "mp3",
      });
      // Even though the mock always returns wav bytes, the server should
      // accept the request successfully.
      assert.equal(status, 200);
    });
  });

  // -------------------------------------------------------------------------
  // POST /v1/audio/speech – error paths
  // -------------------------------------------------------------------------
  describe("POST /v1/audio/speech – validation errors", () => {
    it("returns 400 when input is missing", async () => {
      const { status, body } = await jsonPost("/v1/audio/speech", {
        model: "tts-1",
      });
      assert.equal(status, 400);
      const b = body as { error: { param: string } };
      assert.equal(b.error.param, "input");
    });

    it("returns 400 when input is empty string", async () => {
      const { status } = await jsonPost("/v1/audio/speech", { input: "  " });
      assert.equal(status, 400);
    });

    it("returns 400 when input exceeds 4096 characters", async () => {
      const { status } = await jsonPost("/v1/audio/speech", {
        input: "a".repeat(4097),
      });
      assert.equal(status, 400);
    });

    it("returns 500 when engine throws", async () => {
      const { status, body } = await jsonPost("/v1/audio/speech", {
        input: "FAIL",
      });
      assert.equal(status, 500);
      const b = body as { error: { type: string } };
      assert.equal(b.error.type, "server_error");
    });
  });

  // -------------------------------------------------------------------------
  // Concurrency limiting
  // -------------------------------------------------------------------------
  describe("Concurrency limiting", () => {
    it("returns 429 when maxConcurrency is exceeded", async () => {
      // Create a separate server with maxConcurrency=1 and a slow engine so
      // we can hold the first slot open while firing a second request.
      // Use a ref object to avoid TypeScript narrowing the closure variable to never.
      const ref = { releaseFirst: null as ((() => void) | null) };
      class SlowEngine implements TtsEngine {
        async synthesize(_opts: SynthesisOptions): Promise<SynthesisResult> {
          await new Promise<void>((r) => { ref.releaseFirst = r; });
          return { audio: Buffer.from("X"), format: "wav" };
        }
        async listVoices(): Promise<VoiceInfo[]> { return []; }
      }

      const slowServer = new TtsServer({
        engine: new SlowEngine(),
        port: 18881,
        maxConcurrency: 1,
        logger: { info: () => {}, warn: () => {}, error: () => {} },
      });
      await slowServer.start();

      try {
        // Fire first request (will block in SlowEngine).
        const first = fetch("http://127.0.0.1:18881/v1/audio/speech", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: "hold" }),
        });

        // Give the first request time to enter synthesize().
        await new Promise((r) => setTimeout(r, 50));

        // Fire second request – should get 429.
        const second = await fetch("http://127.0.0.1:18881/v1/audio/speech", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: "blocked" }),
        });
        assert.equal(second.status, 429);
        const b = (await second.json()) as { error: { type: string } };
        assert.equal(b.error.type, "rate_limit_error");

        // Unblock the first request.
        ref.releaseFirst?.();
        await first;
      } finally {
        await slowServer.stop();
      }
    });
  });
});
