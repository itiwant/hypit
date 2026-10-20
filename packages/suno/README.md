# `@hypit/suno`

Exact model contracts for Suno music and sound generation, as Kie's `ai-music-api/*` Market
routes document them.

The package owns model semantics only: which settings exist, their ranges, and which request shape
each capability produces. It owns no API key, no Provider selection, no queue and no network code.
`@hypit/provider-kie` is the Provider that fulfills these requests against Kie.ai.

## Capabilities

| Capability | Module | Result | Kie route |
|---|---|---|---|
| `generate-music` | `@hypit/suno@1` | audio set | `ai-music-api/generate` |
| `generate-sounds` | `@hypit/suno@1` | audio set | `ai-music-api/sounds` |
| `generate-lyrics` | `@hypit/suno@1` | text | `ai-music-api/generate-lyrics` |

`generate-music` declares two modes, exactly as the Kie documentation splits them:

- **Custom mode** (`customMode: true`) — `title` is required (≤80 characters), and at least one of
  `style`, `lyrics` or `negativeTags` must be present. `prompt` is treated strictly as lyrics and
  sung; `lyrics` takes priority over it. `duration` (10–360 s), `vocalGender`, `styleWeight`,
  `weirdnessConstraint`, `audioWeight` and `variety` are effective in this mode only.
- **Non-custom mode** (`customMode: false`) — the prompt is the core idea and lyrics are generated
  automatically. At least one of `imageUrls`, `videoUrls`, `audioUrls`, `style` or `lyrics` must be
  present, and those reference inputs are effective in this mode only. The custom-mode-only
  settings must not be sent here.

The reference inputs keep the Kie limits: up to 5 images, up to 1 video, up to 10 audio entries.
`model` selects the Suno version — `V6`, `V6_MINI` or `V6_WILD`; earlier versions are discontinued.

`generate-sounds` produces sound effects: `prompt` (≤500 characters), `model`, `soundLoop`,
`soundTempo` (BPM 1–300), `soundKey` and `grabLyrics`.

`generate-lyrics` is a text product rather than audio — the Provider reads
`resultJson.resultObject.lyricsData[]` for its variations.

## Notes

- `audioWeight` has no effect on a track without vocals.
- `personaId` and `personaModel` apply a persona or voice created through Kie's persona and voice
  routes; `personaModel` is effective for the V6 family only.
- Provider-specific limits are checked by the Provider before any paid operation; they do not
  narrow the vocabulary this model owns.
