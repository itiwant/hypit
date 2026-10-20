# `@hypit/gemini-tts`

Exact model contracts for Gemini text-to-speech, as Kie's Market pages document them
(`market/google/gemini-*.md`).

The package owns model semantics only: the settings each capability accepts, their ranges, and the
request shape it produces. It owns no API key, no Provider selection, no queue and no network code.
`@hypit/provider-kie` is the Provider that fulfills these requests against Kie.ai.

## Capabilities

| Capability | Result | Kie route |
|---|---|---|
| `gemini-2-5-pro-tts` | audio set | `google/gemini-2-5-pro-tts` |
| `gemini-3-1-flash-tts` | audio set | `google/gemini-3-1-flash-tts` |
| `gemini-3-8-flash-tts` | audio set | `google/gemini-3-8-flash-tts` |
| `gemini-3-8-flash-lite-tts` | audio set | `google/gemini-3-8-flash-lite-tts` |

## Ports

- `speakerId` (9–16 characters) and `speakerVoice` — parallel arrays describing who speaks.
- `turnSpeakerId`, `turnText` (≤10000 characters) and `turnStyle` — parallel arrays describing the
  spoken turns, up to 100 turns.
- `temperature` (0–2), `scene` (≤2000 characters) and `sampleContext` (≤2000 characters) shape the
  delivery; `fillerWords` requests conversational fillers.

The voice catalog in `src/voices.ts` mirrors the documented pages: 30 voices on the 2.5-pro and
3.1-flash pages, 70 on the 3.8-flash and 3.8-flash-lite pages. The Provider zips the parallel
arrays into the documented object arrays before submitting.

## Notes

- The 3.8 Flash capabilities accept the larger voice catalog and the extended style controls; the
  Provider enforces that difference.
- Provider-specific combination limits are checked by the Provider before any paid operation.
