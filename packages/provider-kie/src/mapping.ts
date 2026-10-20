import type { ModuleRef } from "@hypit/hypit/protocol";
import type { GenerationWireMapping } from "@hypit/generation";

const SEEDANCE: ModuleRef = { name: "@hypit/seedance", version: "1" };
const SEEDREAM: ModuleRef = { name: "@hypit/seedream", version: "1" };
const MINIMAX: ModuleRef = { name: "@hypit/minimax-h3", version: "1" };
const GPT_IMAGE: ModuleRef = { name: "@hypit/gpt-image", version: "1" };
const NANO_BANANA: ModuleRef = { name: "@hypit/nano-banana", version: "1" };
const GROK: ModuleRef = { name: "@hypit/grok-imagine", version: "1" };
const WAN: ModuleRef = { name: "@hypit/wan", version: "1" };
const SUNO: ModuleRef = { name: "@hypit/suno", version: "1" };
const ELEVEN_TTS: ModuleRef = { name: "@hypit/elevenlabs-tts", version: "1" };
const GEMINI_TTS: ModuleRef = { name: "@hypit/gemini-tts", version: "1" };

/** The `personReference` item field Seedance's visual references declare; Kie has no such wire input. */
const PERSON_REFERENCE = ["personReference"];

/**
 * Seedance's shared Market input contract: the first/last-frame and multimodal-reference scenarios
 * are mutually exclusive, exactly like the model's own ports; Kie carries `web_search` on every
 * variant (text-to-video scenes only) and `generate_audio`.
 */
const seedanceFields = {
  prompt: { as: "value", field: "prompt" },
  aspectRatio: { as: "value", field: "aspect_ratio" },
  duration: { as: "value", field: "duration" },
  resolution: { as: "value", field: "resolution" },
  firstFrame: { as: "url", field: "first_frame_url", resourceFields: PERSON_REFERENCE },
  lastFrame: { as: "url", field: "last_frame_url", resourceFields: PERSON_REFERENCE },
  referenceImage: { as: "urlArray", field: "reference_image_urls", resourceFields: PERSON_REFERENCE },
  referenceVideo: { as: "urlArray", field: "reference_video_urls", resourceFields: PERSON_REFERENCE },
  referenceAudio: { as: "urlArray", field: "reference_audio_urls" },
  generateAudio: { as: "value", field: "generate_audio" },
  webSearch: { as: "value", field: "web_search" },
} as const satisfies GenerationWireMapping["fields"];

const seedance = (name: string, model: string): GenerationWireMapping => ({
  capability: { module: SEEDANCE, name }, result: "video", routes: [{ model }], fields: seedanceFields,
});

/**
 * One mapping per documented Kie Market route, keyed by the `enum` of each model's spec page
 * (docs.kie.ai, `market/...`, verified field by field). A service whose wire names change per
 * scenario lists one route per wire field shape; the first route whose ports are present wins.
 * `personReference` stays accepted on Seedance references and is not transmitted.
 */
export const kieMappings: readonly GenerationWireMapping[] = [
  seedance("seedance-2", "bytedance/seedance-2"),
  seedance("seedance-2-fast", "bytedance/seedance-2-fast"),
  seedance("seedance-2-mini", "bytedance/seedance-2-mini"),
  {
    // Seedance 2.5's Market page takes every reference kind on the same wire model, so one route
    // covers all of its multimodal scenarios.
    capability: { module: SEEDANCE, name: "seedance-2.5" }, result: "video",
    routes: [{ model: "bytedance/seedance-2-5" }],
    fields: seedanceFields,
  },
  {
    capability: { module: MINIMAX, name: "minimax-h3" }, result: "video",
    routes: [
      { model: "minimax-h3/reference-to-video", whenPresent: ["referenceImage"] },
      { model: "minimax-h3/reference-to-video", whenPresent: ["referenceVideo"] },
      { model: "minimax-h3/image-to-video", whenPresent: ["firstFrame"] },
      { model: "minimax-h3/image-to-video", whenPresent: ["lastFrame"] },
      // Kie's text-to-video page is the only route that makes aspect_ratio required; the
      // supports() layer refuses a text run without it rather than inventing a value.
      { model: "minimax-h3/text-to-video" },
    ],
    fields: {
      prompt: { as: "value", field: "prompt" },
      duration: { as: "value", field: "duration" },
      resolution: { as: "value", field: "resolution" },
      aspectRatio: { as: "value", field: "aspect_ratio" },
      firstFrame: { as: "url", field: "first_frame_url" },
      lastFrame: { as: "url", field: "last_frame_url" },
      referenceImage: { as: "urlArray", field: "reference_image_urls" },
      referenceVideo: { as: "urlArray", field: "reference_video_urls" },
      referenceAudio: { as: "urlArray", field: "reference_audio_urls" },
    },
  },
  {
    capability: { module: GROK, name: "grok-imagine-video" }, result: "video",
    routes: [
      { model: "grok-imagine/image-to-video", whenPresent: ["images"] },
      { model: "grok-imagine/text-to-video" },
    ],
    fields: {
      prompt: { as: "value", field: "prompt" },
      aspectRatio: { as: "value", field: "aspect_ratio" },
      resolution: { as: "value", field: "resolution" },
      duration: { as: "value", field: "duration" },
      images: { as: "urlArray", field: "image_urls" },
    },
  },
  {
    // Kie's model enum for the 1.5 preview carries no slash.
    capability: { module: GROK, name: "grok-imagine-video-1.5-preview" }, result: "video",
    routes: [{ model: "grok-imagine-video-1-5-preview" }],
    fields: {
      prompt: { as: "value", field: "prompt" },
      aspectRatio: { as: "value", field: "aspect_ratio" },
      resolution: { as: "value", field: "resolution" },
      duration: { as: "value", field: "duration" },
      images: { as: "urlArray", field: "image_urls" },
    },
  },
  {
    capability: { module: GPT_IMAGE, name: "gpt-image-2" }, result: "image",
    routes: [
      { model: "gpt-image-2-image-to-image", whenPresent: ["images"] },
      { model: "gpt-image-2-text-to-image" },
    ],
    fields: {
      prompt: { as: "value", field: "prompt" },
      aspectRatio: { as: "value", field: "aspect_ratio" },
      resolution: { as: "value", field: "resolution" },
      background: { as: "value", field: "background" },
      images: { as: "urlArray", field: "input_urls" },
    },
  },
  ...([["nano-banana-2"], ["nano-banana-pro"]] as const).map(([name]): GenerationWireMapping => ({
    capability: { module: NANO_BANANA, name }, result: "image", routes: [{ model: name }],
    fields: {
      prompt: { as: "value", field: "prompt" },
      images: { as: "urlArray", field: "image_input" },
      aspectRatio: { as: "value", field: "aspect_ratio" },
      resolution: { as: "value", field: "resolution" },
      outputFormat: { as: "value", field: "output_format" },
    },
  })),
  {
    capability: { module: SEEDREAM, name: "seedream-5-lite" }, result: "image",
    routes: [
      { model: "seedream/5-lite-image-to-image", whenPresent: ["images"] },
      { model: "seedream/5-lite-text-to-image" },
    ],
    fields: {
      prompt: { as: "value", field: "prompt" },
      aspectRatio: { as: "value", field: "aspect_ratio" },
      quality: { as: "value", field: "quality" },
      outputFormat: { as: "value", field: "output_format" },
      nsfwCheck: { as: "value", field: "nsfw_checker" },
      images: { as: "urlArray", field: "image_urls" },
    },
  },
  ...([["wan-2.7-image", "wan/2-7-image"], ["wan-2.7-image-pro", "wan/2-7-image-pro"]] as const)
    .map(([name, model]): GenerationWireMapping => ({
      capability: { module: WAN, name }, result: "image", routes: [{ model }],
      fields: {
        prompt: { as: "value", field: "prompt" },
        images: { as: "urlArray", field: "input_urls" },
        resolution: { as: "value", field: "resolution" },
        count: { as: "value", field: "n" },
        imageSet: { as: "value", field: "enable_sequential" },
        extendedReasoning: { as: "value", field: "thinking_mode" },
        watermark: { as: "value", field: "watermark" },
        seed: { as: "value", field: "seed" },
      },
    })),
  {
    capability: { module: { name: "@hypit/pixverse", version: "1" }, name: "pixverse-v6" }, result: "video",
    routes: [
      { model: "pixverse-v6/reference-to-video", whenPresent: ["referenceImage"] },
      { model: "pixverse-v6/transition", whenPresent: ["lastFrame"] },
      // A first frame on its own animates through Kie's image-to-video page, which reads
      // `image_urls` (a URL array) instead of the transition page's `first_frame_image_url`;
      // normalize() rewrites the shape after route selection.
      { model: "pixverse-v6/image-to-video", whenPresent: ["firstFrame"] },
      { model: "pixverse-v6/text-to-video" },
    ],
    fields: {
      prompt: { as: "value", field: "prompt" },
      firstFrame: { as: "url", field: "first_frame_image_url" },
      lastFrame: { as: "url", field: "last_frame_image_url" },
      referenceImage: { as: "itemObject", field: "image_references", urlKey: "image_url", fieldKeys: {} },
      // Kie's Fusion mode takes images only; supports() refuses video references on this capability.
      referenceVideo: { as: "urlArray", field: "reference_video_urls__unmapped" },
      duration: { as: "value", field: "duration" },
      quality: { as: "value", field: "quality" },
      aspectRatio: { as: "value", field: "aspect_ratio" },
      generateAudio: { as: "value", field: "generate_audio_switch" },
      multiClip: { as: "value", field: "generate_multi_clip_switch" },
      seed: { as: "value", field: "seed" },
    },
  },
  {
    // Suno's music route. The two-tier naming matters here: the mapping's route
    // `model` is Kie's slug `ai-music-api/generate`, while the port `model` is
    // the Suno version selector (`V6` family) sent as `input.model`.
    capability: { module: SUNO, name: "generate-music" }, result: "audio",
    routes: [{ model: "ai-music-api/generate" }],
    fields: {
      customMode: { as: "value", field: "custom_mode" },
      instrumental: { as: "value", field: "instrumental" },
      model: { as: "value", field: "model" },
      prompt: { as: "value", field: "prompt" },
      lyrics: { as: "value", field: "lyrics" },
      style: { as: "value", field: "style" },
      title: { as: "value", field: "title" },
      negativeTags: { as: "value", field: "negative_tags" },
      vocalGender: { as: "value", field: "vocal_gender" },
      styleWeight: { as: "value", field: "style_weight" },
      weirdnessConstraint: { as: "value", field: "weirdness_constraint" },
      audioWeight: { as: "value", field: "audio_weight" },
      variety: { as: "value", field: "variety" },
      personaId: { as: "value", field: "persona_id" },
      personaModel: { as: "value", field: "persona_model" },
      duration: { as: "value", field: "duration" },
      imageUrls: { as: "urlArray", field: "image_urls" },
      videoUrls: { as: "urlArray", field: "video_urls" },
      audioUrls: { as: "urlArray", field: "audio_urls" },
    },
  },
  {
    capability: { module: SUNO, name: "generate-sounds" }, result: "audio",
    routes: [{ model: "ai-music-api/sounds" }],
    fields: {
      prompt: { as: "value", field: "prompt" },
      model: { as: "value", field: "model" },
      soundLoop: { as: "value", field: "sound_loop" },
      soundTempo: { as: "value", field: "sound_tempo" },
      soundKey: { as: "value", field: "sound_key" },
      grabLyrics: { as: "value", field: "grab_lyrics" },
    },
  },
  {
    capability: { module: ELEVEN_TTS, name: "text-to-speech-multilingual-v2" }, result: "audio",
    routes: [{ model: "elevenlabs/text-to-speech-multilingual-v2" }],
    fields: {
      text: { as: "value", field: "text" },
      voice: { as: "value", field: "voice" },
      stability: { as: "value", field: "stability" },
      similarityBoost: { as: "value", field: "similarity_boost" },
      style: { as: "value", field: "style" },
      speed: { as: "value", field: "speed" },
      timestamps: { as: "value", field: "timestamps" },
      previousText: { as: "value", field: "previous_text" },
      nextText: { as: "value", field: "next_text" },
    },
  },
  {
    capability: { module: ELEVEN_TTS, name: "text-to-speech-turbo-2-5" }, result: "audio",
    routes: [{ model: "elevenlabs/text-to-speech-turbo-2-5" }],
    fields: {
      text: { as: "value", field: "text" },
      voice: { as: "value", field: "voice" },
      stability: { as: "value", field: "stability" },
      similarityBoost: { as: "value", field: "similarity_boost" },
      style: { as: "value", field: "style" },
      speed: { as: "value", field: "speed" },
      timestamps: { as: "value", field: "timestamps" },
      previousText: { as: "value", field: "previous_text" },
      nextText: { as: "value", field: "next_text" },
      languageCode: { as: "value", field: "language_code" },
    },
  },
  {
    // dialogue-v3's `dialogue: [{text, voice}]` is two parallel arrays on the
    // port side; normalize() zips the temporary wire fields into the objects.
    capability: { module: ELEVEN_TTS, name: "text-to-dialogue-v3" }, result: "audio",
    routes: [{ model: "elevenlabs/text-to-dialogue-v3" }],
    fields: {
      dialogueText: { as: "valueArray", field: "dialogue_text" },
      dialogueVoice: { as: "valueArray", field: "dialogue_voice" },
      stability: { as: "value", field: "stability" },
      languageCode: { as: "value", field: "language_code" },
    },
  },
  {
    capability: { module: ELEVEN_TTS, name: "audio-isolation" }, result: "audio",
    routes: [{ model: "elevenlabs/audio-isolation" }],
    fields: {
      source: { as: "url", field: "audio_url" },
    },
  },
  ...([["gemini-2-5-pro-tts", false], ["gemini-3-1-flash-tts", false],
    ["gemini-3-8-flash-tts", true], ["gemini-3-8-flash-lite-tts", true]] as const)
    .map(([name, styled]): GenerationWireMapping => ({
      // speakers[] and dialogue_turns[] are parallel arrays on the port side;
      // normalize() zips them into the documented object arrays.
      capability: { module: GEMINI_TTS, name }, result: "audio",
      routes: [{ model: `google/${name}` }],
      fields: {
        speakerId: { as: "valueArray", field: "speaker_id" },
        speakerVoice: { as: "valueArray", field: "speaker_voice" },
        turnSpeakerId: { as: "valueArray", field: "turn_speaker_id" },
        turnText: { as: "valueArray", field: "turn_text" },
        ...(styled ? { turnStyle: { as: "valueArray" as const, field: "turn_style" } } : {}),
        temperature: { as: "value", field: "temperature" },
        ...(name === "gemini-2-5-pro-tts" || name === "gemini-3-1-flash-tts"
          ? {
            scene: { as: "value" as const, field: "scene" },
            sampleContext: { as: "value" as const, field: "sample_context" },
          }
          : { fillerWords: { as: "value" as const, field: "filler_words" } }),
      },
    })),
];
