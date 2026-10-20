import { createAdmissionPackageFacet } from "@hypit/hypit/admission";
import { createProducerPackageFacet } from "@hypit/hypit/producer";
import { createMarkupSurfaceFacet } from "@hypit/hypit/markup";

import {
  geminiTtsComponent,
  geminiTtsFacet,
  geminiTtsManifest,
  geminiTtsMarkupSurfaces,
} from "./index.js";
import {
  decodeGeminiFlash31Surface,
  decodeGeminiFlash38LiteSurface,
  decodeGeminiFlash38Surface,
  decodeGeminiPro25Surface,
} from "./surface.js";

const geminiTtsModule = { name: "@hypit/gemini-tts", version: "1" } as const;

export const hypitPackage = {
  format: "hypit.package@1" as const,
  modules: [{ manifest: geminiTtsManifest }],
  facets: [
    createProducerPackageFacet(geminiTtsComponent),
    createAdmissionPackageFacet(geminiTtsComponent),
    geminiTtsFacet,
    createMarkupSurfaceFacet({
      module: geminiTtsModule,
      declaration: geminiTtsMarkupSurfaces.find((item) => item.name === "pro25")!,
      handler: decodeGeminiPro25Surface,
    }),
    createMarkupSurfaceFacet({
      module: geminiTtsModule,
      declaration: geminiTtsMarkupSurfaces.find((item) => item.name === "flash31")!,
      handler: decodeGeminiFlash31Surface,
    }),
    createMarkupSurfaceFacet({
      module: geminiTtsModule,
      declaration: geminiTtsMarkupSurfaces.find((item) => item.name === "flash38")!,
      handler: decodeGeminiFlash38Surface,
    }),
    createMarkupSurfaceFacet({
      module: geminiTtsModule,
      declaration: geminiTtsMarkupSurfaces.find((item) => item.name === "flash38Lite")!,
      handler: decodeGeminiFlash38LiteSurface,
    }),
  ],
};
export default hypitPackage;
