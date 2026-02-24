# LMS_Speaks

Text-to-Speech (TTS) plugin for [LM Studio](https://lmstudio.ai), built with the
[`@lmstudio/sdk`](https://github.com/lmstudio-ai/lmstudio.js).

It exposes **OpenAI-compatible TTS endpoints** on a local HTTP server so that any
LLM-environment client (e.g. Open WebUI, SillyTavern, Continue.dev, or your own
scripts) can request speech synthesis without any third-party cloud service.

---

## Features

| Endpoint | Method | Description |
|---|---|---|
| `/v1/audio/speech` | `POST` | Convert text to audio (OpenAI-compatible) |
| `/v1/audio/voices` | `GET` | List available voices |
| `/v1/models` | `GET` | List available TTS models |
| `/health` | `GET` | Liveness probe |

### Supported TTS Engines

| Engine | Value | Notes |
|---|---|---|
| System (OS built-in) | `system` | Uses `say` (macOS), PowerShell (Windows), or `espeak-ng`/`espeak` (Linux) |
| LM Studio TTS model | `lmstudio` | Planned – integrates with TTS models loaded in LM Studio |

---

## Requirements

- **Node.js 18+**
- **LM Studio** (latest release) *when running as a plugin*
- For the **system engine**:
  - macOS: built-in `say` command (no extra install needed)
  - Windows: built-in PowerShell + `System.Speech` (no extra install needed)
  - Linux: `espeak-ng` or `espeak` (`sudo apt install espeak-ng`)

---

## Installation

```bash
# 1. Clone the repo
git clone https://github.com/ObtuseAglet/LMS_Speaks.git
cd LMS_Speaks

# 2. Install dependencies
npm install

# 3. Build
npm run build
```

---

## Usage

### Standalone mode (no LM Studio required)

```bash
# Default port 8880
STANDALONE=true npm start

# Custom port and voice
STANDALONE=true TTS_PORT=9000 TTS_VOICE=Alex npm start
```

### As an LM Studio plugin

1. Open **LM Studio** and navigate to **My Plugins**.
2. Click **Add plugin from local folder** and select this repository folder.
3. LM Studio will detect `lms-manifest.json` and launch the plugin automatically.
4. Configure the port and default voice in the plugin's settings panel.

### Making requests

```bash
# Synthesize speech
curl -X POST http://127.0.0.1:8880/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d '{"model":"tts-1","input":"Hello from LMS Speaks!","voice":"default"}' \
  --output speech.wav

# List voices
curl http://127.0.0.1:8880/v1/audio/voices

# List models
curl http://127.0.0.1:8880/v1/models
```

### OpenAI-compatible client

```typescript
import OpenAI from "openai";
import { writeFileSync } from "fs";

const client = new OpenAI({
  baseURL: "http://127.0.0.1:8880/v1",
  apiKey: "not-needed",
});

const speech = await client.audio.speech.create({
  model: "tts-1",
  voice: "default",
  input: "The quick brown fox jumps over the lazy dog.",
});

writeFileSync("output.wav", Buffer.from(await speech.arrayBuffer()));
```

---

## Configuration

| Environment variable | Default | Description |
|---|---|---|
| `TTS_PORT` | `8880` | Port the HTTP server listens on |
| `TTS_VOICE` | `default` | Default voice when none is specified in the request |
| `STANDALONE` | *(unset)* | Set to `true` to run without LM Studio |

When running as an LM Studio plugin the port, voice, and engine can also be
configured from within LM Studio's plugin settings UI.

---

## API Reference

### `POST /v1/audio/speech`

**Request body** (JSON):

| Field | Type | Required | Description |
|---|---|---|---|
| `input` | `string` | ✅ | Text to synthesize (max 4 096 chars) |
| `model` | `string` | ❌ | `tts-1` or `tts-1-hd` (currently ignored) |
| `voice` | `string` | ❌ | Voice identifier; defaults to the configured default voice |
| `response_format` | `string` | ❌ | `mp3`, `opus`, `aac`, `flac`, `wav`, `pcm`; engine may return `wav` regardless |
| `speed` | `number` | ❌ | Speech speed multiplier 0.25–4.0 (default 1.0) |

**Response**: raw audio bytes with an appropriate `Content-Type` header.

---

## Development

```bash
# Run tests
npm test

# Watch-mode development
STANDALONE=true npm run dev
```

---

## License

MIT
