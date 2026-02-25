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

#### Step 1: Ensure LM Studio is running

1. Download and install [LM Studio](https://lmstudio.ai) (latest version recommended).
2. Launch LM Studio and ensure it's running in the background.
3. **Important**: You do NOT need to load any language model to use this TTS plugin. The plugin works independently of loaded models.

#### Step 2: Install the plugin

1. Open **LM Studio** and navigate to the **My Plugins** section in the sidebar.
2. Click **Add plugin from local folder** (or **+** button).
3. Browse to and select the `LMS_Speaks` repository folder (where you cloned/extracted this project).
4. LM Studio will automatically detect the `lms-manifest.json` file and load the plugin.
5. You should see "lms-speaks" appear in your plugin list with a status indicator.

#### Step 3: Configure the plugin

1. Click on the **lms-speaks** plugin in the list to open its settings panel.
2. Configure the following options:
   - **TTS Server Port**: Port number for the HTTP server (default: 8880). Change this if another service is using port 8880.
   - **Default Voice**: The voice name to use when no voice is specified in requests (default: "default"). See [Voice Configuration](#voice-configuration) below.
   - **TTS Engine**: Currently only "System (OS built-in)" is available. Future versions will support LM Studio TTS models.
3. Click **Apply** or **Save** to activate the settings.

#### Step 4: Verify the plugin is running

Once configured, the plugin will start automatically. You can verify it's running by:

```bash
# Check the health endpoint
curl http://127.0.0.1:8880/health

# Should return: {"status":"ok"}
```

The TTS server is now ready to accept requests from any compatible client application!

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

## Voice Configuration

### Discovering available voices

To see all voices available on your system, query the voices endpoint:

```bash
curl http://127.0.0.1:8880/v1/audio/voices
```

**Example response:**

```json
{
  "voices": [
    {
      "id": "Alex",
      "name": "Alex",
      "language": "en-US"
    },
    {
      "id": "Samantha",
      "name": "Samantha",
      "language": "en-US"
    }
  ]
}
```

### Platform-specific voices

The available voices depend on your operating system:

#### macOS

macOS includes high-quality built-in voices. Common voices include:
- **Alex** - Male, English (US)
- **Samantha** - Female, English (US)
- **Victoria** - Female, English (US)
- **Daniel** - Male, English (UK)
- **Karen** - Female, English (Australia)

To see all available voices on macOS, run in Terminal:
```bash
say -v ?
```

To download additional voices:
1. Open **System Settings** > **Accessibility** > **Spoken Content**
2. Click **System Voice** dropdown
3. Select **Manage Voices...** and download additional language voices

#### Windows

Windows uses the Speech API with voices from the Microsoft Speech Platform:
- **Microsoft David Desktop** - Male, English (US)
- **Microsoft Zira Desktop** - Female, English (US)
- **Microsoft Mark** - Male, English (US)

To see available voices on Windows, run in PowerShell:
```powershell
Add-Type -AssemblyName System.Speech
(New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }
```

To add more voices:
1. Open **Settings** > **Time & Language** > **Speech**
2. Click **Manage voices** and download additional language packs

#### Linux

Linux uses `espeak-ng` (or `espeak` as fallback), which provides synthetic voices:
- **default** - System default voice
- Various language-specific voices (en, en-us, en-gb, es, fr, de, etc.)

To see available voices on Linux:
```bash
espeak-ng --voices
```

To install additional voices:
```bash
sudo apt install espeak-ng-data
```

### Selecting a voice

There are two ways to select a voice:

#### 1. Set a default voice globally

**In LM Studio plugin mode**: Configure the **Default Voice** field in the plugin settings.

**In standalone mode**: Use the `TTS_VOICE` environment variable:
```bash
STANDALONE=true TTS_VOICE=Samantha npm start
```

#### 2. Specify voice per request

Include the `voice` parameter in your API request:

```bash
curl -X POST http://127.0.0.1:8880/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d '{"model":"tts-1","input":"Hello!","voice":"Alex"}' \
  --output speech.wav
```

### Fine-tuning speech output

You can control the speech characteristics using the `speed` parameter:

```bash
# Slower speech (0.5x speed)
curl -X POST http://127.0.0.1:8880/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d '{"input":"Speaking slowly","voice":"Alex","speed":0.5}' \
  --output slow.wav

# Faster speech (1.5x speed)
curl -X POST http://127.0.0.1:8880/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d '{"input":"Speaking quickly","voice":"Alex","speed":1.5}' \
  --output fast.wav
```

**Speed range**: 0.25 to 4.0 (where 1.0 is normal speed)

**Note**: The `system` TTS engine does not support pitch or other advanced tuning. For more control, consider using dedicated TTS models when the `lmstudio` engine becomes available in future versions.

---

## Model Selection

This plugin exposes OpenAI-compatible models for broad compatibility with existing tools:

### Available models

| Model | Description |
|---|---|
| `tts-1` | Standard quality text-to-speech |
| `tts-1-hd` | High-definition quality (currently same as tts-1) |

**Note**: Currently both models use the same underlying system TTS engine. The model parameter is accepted for OpenAI compatibility but does not affect output quality. Future versions will support actual model selection when using LM Studio TTS models.

### Querying available models

```bash
curl http://127.0.0.1:8880/v1/models
```

**Example response:**

```json
{
  "object": "list",
  "data": [
    {
      "id": "tts-1",
      "object": "model",
      "created": 1699000000,
      "owned_by": "system"
    },
    {
      "id": "tts-1-hd",
      "object": "model",
      "created": 1699000000,
      "owned_by": "system"
    }
  ]
}
```

### Future: LM Studio TTS model support

In upcoming versions, you'll be able to:
1. Load TTS models directly in LM Studio (e.g., XTTS, Bark, or other local TTS models)
2. Select the `lmstudio` engine in plugin settings
3. Choose which loaded TTS model to use via the `model` parameter

This will enable higher quality, more customizable speech synthesis while keeping everything local.

---

## Integration with TTS-Compatible Tools

LMS_Speaks provides an OpenAI-compatible API, making it easy to integrate with popular LLM interfaces that support text-to-speech.

### Open WebUI

[Open WebUI](https://github.com/open-webui/open-webui) is a self-hosted ChatGPT-style interface.

**Setup:**

1. Ensure LMS_Speaks is running (verify with `curl http://127.0.0.1:8880/health`)
2. Open your Open WebUI instance
3. Navigate to **Settings** > **Audio**
4. Configure TTS settings:
   - **TTS Engine**: Select "OpenAI"
   - **API Base URL**: `http://127.0.0.1:8880/v1`
   - **API Key**: Leave empty or enter any dummy value (not validated)
   - **TTS Model**: `tts-1` or `tts-1-hd`
   - **TTS Voice**: Choose from your available system voices (e.g., "Alex", "Samantha")
5. Click **Save**

Now when you receive messages in Open WebUI, you can click the speaker icon to hear them read aloud using your local TTS!

### SillyTavern

[SillyTavern](https://github.com/SillyTavern/SillyTavern) is a popular UI for chatting with AI characters.

**Setup:**

1. Start LMS_Speaks (verify it's running)
2. Open SillyTavern
3. Click the **Extensions** menu (puzzle piece icon)
4. Navigate to **TTS** in the extensions panel
5. Configure the TTS provider:
   - **Provider**: Select "OpenAI"
   - **API URL**: `http://127.0.0.1:8880/v1/audio/speech`
   - **Model**: `tts-1`
   - **Voice**: Select your preferred voice from the dropdown
6. Enable **Auto-play TTS** if desired
7. Click **Save Settings**

Characters will now speak their responses using your local TTS system!

### Continue.dev

[Continue](https://continue.dev) is an AI code assistant for VS Code and JetBrains IDEs.

**Setup (VS Code):**

1. Install the Continue extension from the VS Code marketplace
2. Open Continue settings (`Ctrl/Cmd + Shift + P` > "Continue: Open Config")
3. Add TTS configuration to your `config.json`:

```json
{
  "tts": {
    "provider": "openai",
    "baseURL": "http://127.0.0.1:8880/v1",
    "apiKey": "not-needed",
    "model": "tts-1",
    "voice": "default"
  }
}
```

4. Save and reload Continue

**Note**: Continue's TTS support may vary by version. Check their documentation for the latest TTS configuration options.

### Custom applications

Any application supporting OpenAI's TTS API can use LMS_Speaks:

**Python example:**

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:8880/v1",
    api_key="not-needed"  # API key not validated
)

response = client.audio.speech.create(
    model="tts-1",
    voice="Alex",
    input="Hello from Python!"
)

with open("output.wav", "wb") as f:
    f.write(response.content)
```

**JavaScript/TypeScript example:**

```typescript
import OpenAI from "openai";
import { writeFileSync } from "fs";

const client = new OpenAI({
  baseURL: "http://127.0.0.1:8880/v1",
  apiKey: "not-needed",
});

const speech = await client.audio.speech.create({
  model: "tts-1",
  voice: "Alex",
  input: "Hello from JavaScript!",
});

writeFileSync("output.wav", Buffer.from(await speech.arrayBuffer()));
```

### cURL examples

Direct API calls work from any system with curl:

```bash
# Basic synthesis
curl -X POST http://127.0.0.1:8880/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d '{"model":"tts-1","input":"Hello world!","voice":"default"}' \
  --output hello.wav

# With custom speed
curl -X POST http://127.0.0.1:8880/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d '{"model":"tts-1","input":"Speaking fast!","voice":"Alex","speed":1.5}' \
  --output fast.wav
```

---

## Troubleshooting

### Plugin not appearing in LM Studio

**Problem**: The plugin doesn't show up in the My Plugins section.

**Solutions**:
- Ensure `lms-manifest.json` exists in the repository root
- Verify you selected the correct folder (the one containing `lms-manifest.json`)
- Restart LM Studio and try adding the plugin again
- Check LM Studio logs for any error messages

### Port already in use

**Problem**: Error message about port 8880 already being in use.

**Solutions**:
- Change the port in LM Studio plugin settings or use a different `TTS_PORT` value
- Find and stop the process using port 8880:
  ```bash
  # macOS/Linux
  lsof -ti:8880 | xargs kill -9

  # Windows (PowerShell)
  Stop-Process -Id (Get-NetTCPConnection -LocalPort 8880).OwningProcess
  ```

### "No such voice" or voice not working

**Problem**: Specified voice is not recognized or produces no audio.

**Solutions**:
- Query available voices: `curl http://127.0.0.1:8880/v1/audio/voices`
- Use exact voice ID from the voices list
- Try using `"default"` as a fallback voice
- On macOS, verify the voice is installed in System Settings > Accessibility > Spoken Content
- On Windows, install additional voices from Settings > Time & Language > Speech
- On Linux, ensure `espeak-ng` or `espeak` is installed: `sudo apt install espeak-ng`

### Connection refused or cannot reach server

**Problem**: Cannot connect to `http://127.0.0.1:8880`

**Solutions**:
- Verify the plugin/server is running: check LM Studio plugin status or console output
- Check the health endpoint: `curl http://127.0.0.1:8880/health`
- Ensure you're using the correct port (default 8880)
- Check firewall settings aren't blocking localhost connections
- Try `http://localhost:8880` instead of `127.0.0.1`

### Audio quality issues

**Problem**: Generated speech sounds robotic or low quality.

**Solutions**:
- System TTS engines provide basic quality; this is expected behavior
- Try different voices (some are higher quality than others)
- Adjust the `speed` parameter (too fast or slow can degrade quality)
- For production use, consider waiting for LM Studio TTS model support in future versions

### Plugin fails to start or crashes

**Problem**: Plugin shows error status or crashes on startup.

**Solutions**:
- Ensure Node.js 18+ is installed: `node --version`
- Rebuild the project: `npm install && npm run build`
- Check console logs for specific error messages
- Verify all dependencies installed correctly
- Try running in standalone mode first: `STANDALONE=true npm start`

### Integration not working with client application

**Problem**: Open WebUI, SillyTavern, or other client can't use TTS.

**Solutions**:
- Verify LMS_Speaks is running and accessible
- Test the endpoint directly with curl first
- Check the client's TTS configuration matches the examples above
- Ensure you're using the correct base URL format (with `/v1` for OpenAI compatibility)
- Some clients may require restart after configuration changes
- Check client logs for specific error messages

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
