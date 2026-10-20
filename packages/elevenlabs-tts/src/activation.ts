import { createAdmissionPackageFacet } from "@hypit/hypit/admission";
import { createProducerPackageFacet } from "@hypit/hypit/producer";

import { elevenLabsTtsComponent, elevenLabsTtsFacet, elevenLabsTtsManifest } from "./index.js";

export const hypitPackage = {
  format: "hypit.package@1" as const,
  modules: [{ manifest: elevenLabsTtsManifest }],
  facets: [
    createProducerPackageFacet(elevenLabsTtsComponent),
    createAdmissionPackageFacet(elevenLabsTtsComponent),
    elevenLabsTtsFacet,
  ],
};
export default hypitPackage;
