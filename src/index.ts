/**
 * LMS Speaks – LM Studio TTS Plugin
 *
 * Entry point for the plugin when launched by LM Studio.
 *
 * Behaviour
 * ---------
 * 1. Connect to the running LM Studio instance via the SDK client.
 * 2. Register this plugin and expose its global configuration schematics so
 *    users can configure the TTS server port, default voice, and TTS engine
 *    from within LM Studio.
 * 3. Start a local HTTP server that exposes OpenAI-compatible TTS endpoints:
 *      POST /v1/audio/speech  – convert text to audio
 *      GET  /v1/audio/voices  – list available voices
 *      GET  /v1/models        – list available TTS models
 *      GET  /health           – liveness probe
 *
 * Running as a development plugin
 * --------------------------------
 * When developing / testing without a full LM Studio installation you can run
 * the server standalone (bypassing LM Studio registration) by setting the
 * environment variable STANDALONE=true:
 *
 *   STANDALONE=true npm run dev
 *
 * The server will start on the default port (8880) with the system TTS engine.
 */

import { LMStudioClient } from "@lmstudio/sdk";
import { globalConfigSchematics } from "./config.js";
import { SystemTtsEngine, LmStudioTtsEngine } from "./tts-engine.js";
import type { TtsEngine } from "./tts-engine.js";
import { TtsServer } from "./server.js";

const DEFAULT_PORT = 8880;

async function main(): Promise<void> {
  // ------------------------------------------------------------------
  // Standalone mode (no LM Studio required)
  // ------------------------------------------------------------------
  if (process.env["STANDALONE"] === "true") {
    const port = Number(process.env["TTS_PORT"] ?? DEFAULT_PORT);
    const voice = process.env["TTS_VOICE"] ?? "default";
    const engineType = process.env["TTS_ENGINE"] ?? "system";
    console.info("[LMS Speaks] Running in standalone mode.");

    let engine: TtsEngine;
    if (engineType === "lmstudio") {
      const apiBaseUrl =
        process.env["LMS_API_BASE_URL"] ?? "http://127.0.0.1:1234";
      const modelKey = process.env["TTS_MODEL_KEY"] || undefined;
      console.info(
        `[LMS Speaks] Using LM Studio engine (API: ${apiBaseUrl}` +
          (modelKey ? `, model: ${modelKey})` : ")")
      );
      engine = new LmStudioTtsEngine({ apiBaseUrl, modelKey });
    } else {
      engine = new SystemTtsEngine();
    }

    const server = new TtsServer({ engine, port, defaultVoice: voice });
    await server.start();

    let isShuttingDown = false;
    const shutdown = async () => {
      if (isShuttingDown) return;
      isShuttingDown = true;
      console.info("[LMS Speaks] Shutting down…");
      await server.stop();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    return;
  }

  // ------------------------------------------------------------------
  // Plugin mode – register with LM Studio
  // ------------------------------------------------------------------
  const client = new LMStudioClient();

  // Retrieve the self-registration host.  The SDK injects the
  // clientIdentifier / clientPasskey via environment variables when
  // LM Studio launches the plugin; we just need to call getSelfRegistrationHost().
  const host = client.plugins.getSelfRegistrationHost();

  // Register global configuration schematics so users can change the
  // TTS server port, default voice, and engine from within LM Studio.
  await host.setGlobalConfigSchematics(globalConfigSchematics);

  // Signal that initialisation is complete so LM Studio shows the plugin
  // as "loaded" in the UI.
  await host.initCompleted();

  // ----------------------------------------------------------------
  // Read the resolved configuration and start the TTS server.
  // ----------------------------------------------------------------
  // We cannot call getGlobalPluginConfig() without a prediction context,
  // so we read the raw environment overrides or fall back to defaults.
  const port =
    Number(process.env["TTS_PORT"] ?? DEFAULT_PORT);
  const voice = process.env["TTS_VOICE"] ?? "default";
  const engineType = process.env["TTS_ENGINE"] ?? "system";

  console.info(
    `[LMS Speaks] Plugin registered. Starting TTS server on port ${port}…`
  );

  let engine: TtsEngine;
  if (engineType === "lmstudio") {
    const apiBaseUrl =
      process.env["LMS_API_BASE_URL"] ?? "http://127.0.0.1:1234";
    const modelKey = process.env["TTS_MODEL_KEY"] || undefined;
    console.info(
      `[LMS Speaks] Using LM Studio engine (API: ${apiBaseUrl}` +
        (modelKey ? `, model: ${modelKey})` : ")")
    );
    engine = new LmStudioTtsEngine({ client, apiBaseUrl, modelKey });
  } else {
    engine = new SystemTtsEngine();
  }

  const server = new TtsServer({ engine, port, defaultVoice: voice });
  await server.start();

  // ----------------------------------------------------------------
  // Graceful shutdown
  // ----------------------------------------------------------------
  let isShuttingDown = false;
  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.info("[LMS Speaks] Shutting down…");
    await server.stop();
    await client[Symbol.asyncDispose]();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[LMS Speaks] Fatal error:", err);
  process.exit(1);
});
