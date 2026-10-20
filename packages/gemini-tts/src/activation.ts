import { createAdmissionPackageFacet } from "@hypit/hypit/admission";
import { createProducerPackageFacet } from "@hypit/hypit/producer";

import { geminiTtsComponent, geminiTtsFacet, geminiTtsManifest } from "./index.js";

export const hypitPackage = {
  format: "hypit.package@1" as const,
  modules: [{ manifest: geminiTtsManifest }],
  facets: [
    createProducerPackageFacet(geminiTtsComponent),
    createAdmissionPackageFacet(geminiTtsComponent),
    geminiTtsFacet,
  ],
};
export default hypitPackage;
