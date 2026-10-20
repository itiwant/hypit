import { createAdmissionPackageFacet } from "@hypit/hypit/admission";
import { createProducerPackageFacet } from "@hypit/hypit/producer";
import { createMarkupSurfaceFacet } from "@hypit/hypit/markup";

import {
  elevenLabsTtsComponent,
  elevenLabsTtsFacet,
  elevenLabsTtsManifest,
  elevenLabsTtsMarkupSurfaces,
} from "./index.js";
import {
  decodeElevenLabsDialogueSurface,
  decodeElevenLabsIsolationSurface,
  decodeElevenLabsMultilingualSurface,
  decodeElevenLabsTurboSurface,
} from "./surface.js";

const elevenLabsTtsModule = { name: "@hypit/elevenlabs-tts", version: "1" } as const;

export const hypitPackage = {
  format: "hypit.package@1" as const,
  modules: [{ manifest: elevenLabsTtsManifest }],
  facets: [
    createProducerPackageFacet(elevenLabsTtsComponent),
    createAdmissionPackageFacet(elevenLabsTtsComponent),
    elevenLabsTtsFacet,
    createMarkupSurfaceFacet({
      module: elevenLabsTtsModule,
      declaration: elevenLabsTtsMarkupSurfaces.find((item) => item.name === "speech")!,
      handler: decodeElevenLabsMultilingualSurface,
    }),
    createMarkupSurfaceFacet({
      module: elevenLabsTtsModule,
      declaration: elevenLabsTtsMarkupSurfaces.find((item) => item.name === "turbo")!,
      handler: decodeElevenLabsTurboSurface,
    }),
    createMarkupSurfaceFacet({
      module: elevenLabsTtsModule,
      declaration: elevenLabsTtsMarkupSurfaces.find((item) => item.name === "dialogue")!,
      handler: decodeElevenLabsDialogueSurface,
    }),
    createMarkupSurfaceFacet({
      module: elevenLabsTtsModule,
      declaration: elevenLabsTtsMarkupSurfaces.find((item) => item.name === "isolation")!,
      handler: decodeElevenLabsIsolationSurface,
    }),
  ],
};
export default hypitPackage;
