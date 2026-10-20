# `@hypit/elevenlabs-tts`

Exact model contracts for ElevenLabs speech generation, as Kie's Market pages document them
(`market/elevenlabs/*.md`).

The package owns model semantics only: the settings each capability accepts, their ranges, and the
request shape it produces. It owns no API key, no Provider selection, no queue and no network code.
`@hypit/provider-kie` is the Provider that fulfills these requests against Kie.ai.

## Capabilities

| Capability | Result | Kie route |
|---|---|---|
| `text-to-speech-multilingual-v2` | audio set | `elevenlabs/text-to-speech-multilingual-v2` |
| `text-to-speech-turbo-2-5` | audio set | `elevenlabs/text-to-speech-turbo-2-5` |
| `text-to-dialogue-v3` | audio set | `elevenlabs/text-to-dialogue-v3` |
| `audio-isolation` | audio set | `elevenlabs/audio-isolation` |

## Ports

- **Speech** — `text` (≤5000 characters), `voice` (an ElevenLabs voice id from the package's
  catalog), `stability` (0–1), `similarityBoost` (0–1), `style` (0–1), `speed` (0.7–1.2),
  `timestamps`, plus the continuity pair `previousText` / `nextText` for context.
- **Dialogue** — `dialogueText` and `dialogueVoice` as parallel arrays (up to 100 turns), with
  `stability` restricted to 0, 0.5 or 1, and `languageCode` from the package's catalog.
- **Isolation** — `source`, the audio to clean.

The Provider relays the documented wire shape: the dialogue arrays are zipped into the
documented object arrays, and the spoken language is carried by the documented field.

## Notes

- `voice` is required for the speech capabilities; the catalog in `src/voices.ts` lists the
  documented voice ids.
- Provider-specific combination limits are checked by the Provider before any paid operation.
