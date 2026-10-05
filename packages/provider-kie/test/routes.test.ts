import assert from "node:assert/strict";
import test from "node:test";
import { assertMappingCoversPorts, generationTypes } from "@hypit/generation";
import type { BlobRef, CanonicalValue } from "@hypit/protocol";
import { gptImage2Ports, sealGptImage2Request } from "@hypit/gpt-image";
import { grokImagine15PreviewPorts, grokImagineVideoPorts, sealGrokImagineRequest } from "@hypit/grok-imagine";
import { minimaxH3Ports, sealMinimaxH3Request } from "@hypit/minimax-h3";
import { nanoBananaPorts, sealNanoBananaRequest } from "@hypit/nano-banana";
import { pixversePorts, sealPixverseRequest } from "@hypit/pixverse";
import { seedancePorts, sealSeedanceRequest } from "@hypit/seedance";
import { seedream5LitePorts, sealSeedreamRequest } from "@hypit/seedream";
import { wanPorts, sealWanRequest } from "@hypit/wan";

import { kieMappings } from "../src/mapping.js";
import { kieRouteForCapability } from "../src/routes.js";

const image: BlobRef = { kind: "blob", resource: "res_kie_image", size: 4, mediaType: "image/png" };
const video: BlobRef = { kind: "blob", resource: "res_kie_video", size: 4, mediaType: "video/mp4" };
const resolve = async () => "https://cdn.kie.ai/uploaded";
const URL_ = "https://cdn.kie.ai/uploaded";

const capabilityOf = {
  seedance: "@hypit/seedance", minimax: "@hypit/minimax-h3", grok: "@hypit/grok-imagine",
  gpt: "@hypit/gpt-image", banana: "@hypit/nano-banana", seedream: "@hypit/seedream", wan: "@hypit/wan",
  pixverse: "@hypit/pixverse",
} as const;

function portsFor(moduleName: string, name: string) {
  if (moduleName === capabilityOf.seedance) return seedancePorts[name as keyof typeof seedancePorts];
  if (moduleName === capabilityOf.minimax) return minimaxH3Ports;
  if (moduleName === capabilityOf.grok) return name === "grok-imagine-video"
    ? grokImagineVideoPorts
    : grokImagine15PreviewPorts;
  if (moduleName === capabilityOf.gpt) return gptImage2Ports;
  if (moduleName === capabilityOf.banana) return nanoBananaPorts[name as keyof typeof nanoBananaPorts];
  if (moduleName === capabilityOf.seedream) return seedream5LitePorts;
  if (moduleName === capabilityOf.wan) return wanPorts[name as keyof typeof wanPorts];
  return pixversePorts[name as keyof typeof pixversePorts];
}

test("every Kie mapping covers its model's ports and keeps a public result", () => {
  for (const mapping of kieMappings) {
    const table = portsFor(mapping.capability.module.name, mapping.capability.name);
    assert(table !== undefined, `no port table for ${mapping.capability.name}`);
    assertMappingCoversPorts(table, mapping);
    assert(mapping.result === "image" || mapping.result === "video" || mapping.result === "audio",
      `mapping ${mapping.capability.name} has no public result kind`);
  }
});

test("Seedance relays one Media input per scenario to the Market model", async () => {
  const route = kieRouteForCapability({ module: { name: "@hypit/seedance", version: "1" }, name: "seedance-2-mini" })!;
  const request = sealSeedanceRequest("seedance-2-mini", {
    prompt: ["turn"], aspectRatio: ["9:16"], duration: [6], resolution: ["720p"],
    referenceImage: [{ role: "image", artifact: image, fields: { personReference: true } }],
    generateAudio: [true], webSearch: [false],
  });
  const prepared = route.prepare(request as unknown as CanonicalValue);
  assert.equal(prepared.model, "bytedance/seedance-2-mini");
  assert.deepEqual(await prepared.compile(resolve), {
    prompt: "turn", aspect_ratio: "9:16", duration: 6, resolution: "720p",
    reference_image_urls: [URL_], generate_audio: true, web_search: false,
  });
});

test("Minimax H3 selects the reference route, the frame route or the bare route", () => {
  const route = kieRouteForCapability({ module: { name: "@hypit/minimax-h3", version: "1" }, name: "minimax-h3" })!;
  const choose = (ports: Record<string, unknown>) =>
    route.prepare(sealMinimaxH3Request(ports as never) as unknown as CanonicalValue).model;
  assert.equal(choose({ prompt: ["turn"], aspectRatio: ["16:9"], duration: [6], resolution: ["768P"] }),
    "minimax-h3/text-to-video");
  assert.equal(choose({ prompt: ["turn"], duration: [6], resolution: ["768P"], referenceVideo: [{ role: "video", artifact: video }] }),
    "minimax-h3/reference-to-video");
  assert.equal(choose({ prompt: ["turn"], duration: [6], resolution: ["768P"], firstFrame: [{ role: "image", artifact: image }] }),
    "minimax-h3/image-to-video");
});

test("Minimax H3 text runs need a ratio; frame runs drop the ratio", () => {
  const route = kieRouteForCapability({ module: { name: "@hypit/minimax-h3", version: "1" }, name: "minimax-h3" })!;
  assert.throws(() => route.prepare(sealMinimaxH3Request({
    prompt: ["turn"], duration: [6], resolution: ["768P"],
  }) as unknown as CanonicalValue), /requires aspect_ratio/u);
  const withFrames = route.prepare(sealMinimaxH3Request({
    prompt: ["turn"], duration: [6], resolution: ["768P"], firstFrame: [{ role: "image", artifact: image }],
  }) as unknown as CanonicalValue);
  assert.equal(withFrames.model, "minimax-h3/image-to-video");
});

test("GPT Image 2 keeps its two routes apart and drops GPT-only ports when Kie refuses them", () => {
  const route = kieRouteForCapability({ module: { name: "@hypit/gpt-image", version: "1" }, name: "gpt-image-2" })!;
  const withImages = route.prepare(sealGptImage2Request({
    prompt: ["turn"], images: [{ role: "image", artifact: image }], resolution: ["1K"], aspectRatio: ["1:1"],
  }) as unknown as CanonicalValue);
  assert.equal(withImages.model, "gpt-image-2-image-to-image");
  const bare = route.prepare(sealGptImage2Request({
    prompt: ["turn"], resolution: ["1K"], aspectRatio: ["1:1"], background: ["opaque"],
  }) as unknown as CanonicalValue);
  assert.equal(bare.model, "gpt-image-2-text-to-image");
  for (const request of [
    sealGptImage2Request({ prompt: ["turn"], resolution: ["2K"], aspectRatio: ["9:21"] }),
    sealGptImage2Request({ prompt: ["turn"], resolution: ["4K"], aspectRatio: ["1:1"] }),
    sealGptImage2Request({ prompt: ["turn"], resolution: ["2K"], aspectRatio: ["16:9"], background: ["opaque"] }),
    sealGptImage2Request({ prompt: ["turn"], resolution: ["2K"], aspectRatio: ["auto"] }),
  ]) {
    assert.throws(() => route.prepare(request as unknown as CanonicalValue), /Kie GPT Image 2/u);
  }
});

test("Grok Imagine keeps 1080p single-image and the 1.5 preview reads no user ratio for one image", () => {
  const route = kieRouteForCapability(
    { module: { name: "@hypit/grok-imagine", version: "1" }, name: "grok-imagine-video" },
  )!;
  const multi = sealGrokImagineRequest("grok-imagine-video", {
    prompt: ["turn"], images: [{ role: "image", artifact: image }, { role: "image", artifact: image }],
    aspectRatio: ["16:9"], resolution: ["1080p"], duration: [10],
  });
  assert.throws(() => route.prepare(multi as unknown as CanonicalValue), /1080p/u);
  const withImage = route.prepare(sealGrokImagineRequest("grok-imagine-video", {
    prompt: ["turn"], images: [{ role: "image", artifact: image }],
    aspectRatio: ["16:9"], resolution: ["480p"], duration: [10],
  }) as unknown as CanonicalValue);
  assert.equal(withImage.model, "grok-imagine/image-to-video");
  const preview = kieRouteForCapability(
    { module: { name: "@hypit/grok-imagine", version: "1" }, name: "grok-imagine-video-1.5-preview" },
  )!;
  const pinned = sealGrokImagineRequest("grok-imagine-video-1.5-preview", {
    prompt: ["turn"], images: [{ role: "image", artifact: image }], aspectRatio: ["9:16"],
    resolution: ["480p"], duration: [10],
  });
  assert.throws(() => preview.prepare(pinned as unknown as CanonicalValue), /reads the aspect ratio/u);
});

test("Nano Banana maps every input exactly once; the model prompt caps hold", () => {
  const route = kieRouteForCapability({ module: { name: "@hypit/nano-banana", version: "1" }, name: "nano-banana-2" })!;
  const request = nanoBanana2Request();
  const prepared = route.prepare(request as unknown as CanonicalValue);
  assert.equal(prepared.model, "nano-banana-2");
});
function nanoBanana2Request() {
  return sealNanoBananaRequest("nano-banana-2", {
    prompt: ["turn"], images: [{ role: "image", artifact: image }], aspectRatio: ["1:1"], resolution: ["1K"],
    outputFormat: ["png"],
  });
}

test("Seedream 5 Lite relays its two routes, quality and the nsfw switch", () => {
  const route = kieRouteForCapability(
    { module: { name: "@hypit/seedream", version: "1" }, name: "seedream-5-lite" },
  )!;
  const withImage = sealSeedreamRequest({
    prompt: ["turn"], quality: ["high"], aspectRatio: ["16:9"], outputFormat: ["png"], nsfwCheck: [true],
    images: [{ role: "image", artifact: image }],
  });
  const prepared = route.prepare(withImage as unknown as CanonicalValue);
  assert.equal(prepared.model, "seedream/5-lite-image-to-image");
  const bare = route.prepare(sealSeedreamRequest({
    prompt: ["turn"], quality: ["high"], aspectRatio: ["16:9"], outputFormat: ["png"], nsfwCheck: [false],
  }) as unknown as CanonicalValue);
  assert.equal(bare.model, "seedream/5-lite-text-to-image");
});

test("Wan 2.7 relays switches verbatim and refuses Kie-beyond modes", async () => {
  const route = kieRouteForCapability({ module: { name: "@hypit/wan", version: "1" }, name: "wan-2.7-image" })!;
  const prepared = route.prepare(sealWanRequest("wan-2.7-image", {
    prompt: ["turn"], count: [3], resolution: ["2K"], imageSet: [true], watermark: [false],
  }) as unknown as CanonicalValue);
  assert.equal(prepared.model, "wan/2-7-image");
  const input = await prepared.compile(resolve) as Record<string, unknown>;
  assert.deepEqual(input, {
    prompt: "turn", n: 3, resolution: "2K", enable_sequential: true, watermark: false,
  });

  // Kie spells thinking_mode as a boolean of its own; the value relays untouched.
  const thinking = route.prepare(sealWanRequest("wan-2.7-image", {
    prompt: ["turn"], extendedReasoning: [true],
  }) as unknown as CanonicalValue);
  const thinkingInput = await thinking.compile(resolve) as Record<string, unknown>;
  assert.equal(thinkingInput.thinking_mode, true);

  const pro = kieRouteForCapability({ module: { name: "@hypit/wan", version: "1" }, name: "wan-2.7-image-pro" })!;
  const fourK = sealWanRequest("wan-2.7-image-pro", { prompt: ["turn"], images: [{ role: "image", artifact: image }],
    resolution: ["4K"] });
  assert.throws(() => pro.prepare(fourK as unknown as CanonicalValue), /4K only for text-to-image/u);
  const sequentialFourK = sealWanRequest("wan-2.7-image-pro", { prompt: ["turn"], resolution: ["4K"],
    imageSet: [true] });
  assert.throws(() => pro.prepare(sequentialFourK as unknown as CanonicalValue), /4K only for text-to-image/u);
  const plainFourK = sealWanRequest("wan-2.7-image-pro", { prompt: ["turn"], resolution: ["4K"] });
  assert.equal(pro.prepare(plainFourK as unknown as CanonicalValue).model, "wan/2-7-image-pro");
  const many = sealWanRequest("wan-2.7-image", { prompt: ["turn"], count: [8] });
  assert.throws(() => route.prepare(many as unknown as CanonicalValue), /four pictures/u);
  const sequential = route.prepare(sealWanRequest("wan-2.7-image",
    { prompt: ["turn"], count: [8], imageSet: [true] }) as unknown as CanonicalValue);
  assert.equal(sequential.model, "wan/2-7-image");
  const reasoningWithImages = sealWanRequest("wan-2.7-image", {
    prompt: ["turn"], images: [{ role: "image", artifact: image }], extendedReasoning: [true],
  });
  assert.throws(() => route.prepare(reasoningWithImages as unknown as CanonicalValue), /thinking_mode/u);
});

test("PixVerse V6 addresses references positionally like the model surface", async () => {
  const route = kieRouteForCapability({ module: { name: "@hypit/pixverse", version: "1" }, name: "pixverse-v6" })!;
  const prepared = route.prepare(sealPixverseRequest("pixverse-v6", {
    prompt: ["turn @ref_1"], duration: [10], quality: ["720p"], aspectRatio: ["9:16"],
    referenceImage: [{ role: "image", artifact: image }, { role: "image", artifact: image }],
  }) as unknown as CanonicalValue);
  assert.equal(prepared.model, "pixverse-v6/reference-to-video");
  const input = await prepared.compile(resolve) as Record<string, unknown>;
  assert.deepEqual(input.image_references, [
    { image_url: URL_, ref_name: "ref_1" },
    { image_url: URL_, ref_name: "ref_2" },
  ]);
});

test("PixVerse V6 refuses what Kie's Fusion cannot carry", () => {
  const route = kieRouteForCapability({ module: { name: "@hypit/pixverse", version: "1" }, name: "pixverse-v6" })!;
  const throws = (ports: Record<string, unknown>, pattern: RegExp) => {
    assert.throws(() => route.prepare(sealPixverseRequest("pixverse-v6",
      ports as never) as unknown as CanonicalValue), pattern);
  };
  throws({ prompt: ["turn"], quality: ["720p"], aspectRatio: ["16:9"],
    referenceVideo: [{ role: "video", artifact: video }] }, /image references only/u);
  throws({ prompt: ["turn"], quality: ["720p"], aspectRatio: ["9:16"] }, /explicit duration/u);
  throws({ prompt: ["turn"], duration: [10], quality: ["720p"], aspectRatio: ["auto"] }, /no auto aspect ratio/u);
  throws({ prompt: ["turn"], duration: [10], quality: ["720p"] }, /aspect_ratio/u);
  throws({ prompt: ["turn"], duration: [10], quality: ["720p"], aspectRatio: ["9:16"],
    referenceImage: Array.from({ length: 8 }, (_, index) => ({ role: "image", artifact: image })) },
  /seven reference images/u);
});

test("PixVerse V6 animates a lone first frame through Kie's image-to-video shape", async () => {
  const route = kieRouteForCapability({ module: { name: "@hypit/pixverse", version: "1" }, name: "pixverse-v6" })!;
  const firstOnly = route.prepare(sealPixverseRequest("pixverse-v6", {
    prompt: ["turn"], duration: [10], quality: ["720p"],
    firstFrame: [{ role: "image", artifact: image }],
  }) as unknown as CanonicalValue);
  assert.equal(firstOnly.model, "pixverse-v6/image-to-video");
  const firstInput = await firstOnly.compile(resolve) as Record<string, unknown>;
  assert.deepEqual(firstInput, {
    prompt: "turn", image_urls: [URL_], duration: 10, quality: "720p",
  });

  const pair = route.prepare(sealPixverseRequest("pixverse-v6", {
    prompt: ["turn"], duration: [10], quality: ["720p"],
    firstFrame: [{ role: "image", artifact: image }], lastFrame: [{ role: "image", artifact: image }],
  }) as unknown as CanonicalValue);
  assert.equal(pair.model, "pixverse-v6/transition");
  const pairInput = await pair.compile(resolve) as Record<string, unknown>;
  assert.deepEqual(pairInput, {
    prompt: "turn", first_frame_image_url: URL_, last_frame_image_url: URL_, duration: 10, quality: "720p",
  });
});

test("Generation types module refs stay aligned with the plan's result types", () => {
  for (const route of kieMappings) {
    const prepared = kieRouteForCapability(route.capability)!;
    const named = route.capability.module.name === capabilityOf.gpt
      || route.capability.module.name === capabilityOf.banana
      || route.capability.module.name === capabilityOf.seedream
      || route.capability.module.name === capabilityOf.wan;
    assert.equal(prepared.returns.name, named ? generationTypes.imageSet.name : generationTypes.videoSet.name);
  }
});
