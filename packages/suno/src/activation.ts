import { createAdmissionPackageFacet } from "@hypit/hypit/admission";
import { createProducerPackageFacet } from "@hypit/hypit/producer";
import { createMarkupSurfaceFacet } from "@hypit/hypit/markup";

import { sunoComponent, sunoFacet, sunoManifest, sunoMarkupSurfaces } from "./index.js";
import { decodeSunoMusicSurface, decodeSunoSoundsSurface } from "./surface.js";

const sunoModule = { name: "@hypit/suno", version: "1" } as const;

export const hypitPackage = {
  format: "hypit.package@1" as const,
  modules: [{ manifest: sunoManifest }],
  facets: [
    createProducerPackageFacet(sunoComponent),
    createAdmissionPackageFacet(sunoComponent),
    sunoFacet,
    createMarkupSurfaceFacet({
      module: sunoModule,
      declaration: sunoMarkupSurfaces.find((item) => item.name === "music")!,
      handler: decodeSunoMusicSurface,
    }),
    createMarkupSurfaceFacet({
      module: sunoModule,
      declaration: sunoMarkupSurfaces.find((item) => item.name === "sounds")!,
      handler: decodeSunoSoundsSurface,
    }),
  ],
};
export default hypitPackage;
