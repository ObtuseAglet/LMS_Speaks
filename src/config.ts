import { createConfigSchematics } from "@lmstudio/sdk";

/**
 * Global plugin configuration schematics.
 * These settings are application-wide and persist across chats.
 */
export const globalConfigSchematics = createConfigSchematics()
  .field(
    "ttsServerPort",
    "numeric",
    {
      min: 1,
      max: 65535,
      int: true,
      shortHand: "Port",
      displayName: "TTS Server Port",
      hint: "The local port on which the TTS HTTP server will listen (default: 8880).",
    },
    8880
  )
  .field(
    "defaultVoice",
    "string",
    {
      displayName: "Default Voice",
      hint: "Default voice used when no voice parameter is provided in a request.",
      placeholder: "default",
    },
    "default"
  )
  .field(
    "ttsEngine",
    "select",
    {
      displayName: "TTS Engine",
      hint: "The TTS backend to use for speech synthesis.",
      options: [
        { value: "system", displayName: "System (OS built-in)" },
      ],
    },
    "system"
  )
  .build();

export type GlobalConfig = typeof globalConfigSchematics;
