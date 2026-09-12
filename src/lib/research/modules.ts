// The eleven Research & Innovation modules, as one registry.
//
// Each R&D list page knows its own endpoint, but the shared record page
// (/r-and-d/record/[module]/[id]) is reached by slug alone and has to resolve
// the rest. The three things it needs are all irregular enough that they can't
// be derived from the slug:
//
//   - research-profiles reads from the SINGULAR /api/college/research-profile
//   - the JSON key differs per module: records / projects / requests / publications
//
// so they're stated here rather than guessed. A module missing from this map
// simply has no record page; the page 404s rather than fetching a wrong URL.

export interface ResearchModuleConfig {
  /** Route segment under /r-and-d, and the key in this map. */
  slug: string;
  /** Path under /api/college. */
  apiPath: string;
  /** The array key in that endpoint's JSON response. */
  responseKey: string;
  /** Page heading for a single record of this kind. */
  label: string;
}

export const RESEARCH_MODULES: Record<string, ResearchModuleConfig> = {
  "publications": { slug: "publications", apiPath: "publications", responseKey: "publications", label: "Research Publication" },
  "research-profiles": { slug: "research-profiles", apiPath: "research-profile", responseKey: "requests", label: "Research Profile" },
  "citation-metrics": { slug: "citation-metrics", apiPath: "citation-metrics", responseKey: "requests", label: "Citation Metrics" },
  "consultancy-projects": { slug: "consultancy-projects", apiPath: "consultancy-projects", responseKey: "projects", label: "Consultancy Project" },
  "seed-funding": { slug: "seed-funding", apiPath: "seed-funding", responseKey: "projects", label: "Seed Funding" },
  "sponsored-projects": { slug: "sponsored-projects", apiPath: "sponsored-projects", responseKey: "projects", label: "Sponsored Research Project" },
  "discovery-innovation": { slug: "discovery-innovation", apiPath: "discovery-innovation", responseKey: "records", label: "Discovery & Innovation (IPR)" },
  "phd-supervision": { slug: "phd-supervision", apiPath: "phd-supervision", responseKey: "records", label: "Ph.D. Supervision" },
  "research-services": { slug: "research-services", apiPath: "research-services", responseKey: "records", label: "Research Service & Contribution" },
  "hackathons": { slug: "hackathons", apiPath: "hackathons", responseKey: "records", label: "Hackathon / Competition" },
  "innovations": { slug: "innovations", apiPath: "innovations", responseKey: "records", label: "Innovation" },
};

/** Where a record of this module is viewed in full. */
export function researchRecordHref(slug: string, id: string): string {
  return `/r-and-d/record/${slug}/${id}`;
}
