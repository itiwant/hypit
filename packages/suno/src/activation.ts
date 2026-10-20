import { createAdmissionPackageFacet } from "@hypit/hypit/admission";
import { createProducerPackageFacet } from "@hypit/hypit/producer";

import { sunoComponent, sunoFacet, sunoManifest } from "./index.js";

export const hypitPackage = {
  format: "hypit.package@1" as const,
  modules: [{ manifest: sunoManifest }],
  facets: [
    createProducerPackageFacet(sunoComponent),
    createAdmissionPackageFacet(sunoComponent),
    sunoFacet,
  ],
};
export default hypitPackage;
