// The Research & Innovation module's own sub-tabs (see
// ResearchInnovationModule) - Research Publications (the R&D-managed
// publication list) and Research Profiles (self-reported researcher IDs:
// ORCID, Scopus, Researcher ID, Google Scholar, IRINS) are the only ones
// with real fields so far, same content this module always had before being
// split across the two; the rest are scaffolded empty for now, one field set
// to be built out later at a time.
export type ResearchInnovationTabKey =
  | "research-profiles"
  | "citations"
  | "publications"
  | "discovery-innovation"
  | "sponsored-projects"
  | "seed-funding"
  | "consultancy-projects"
  | "phd-supervision"
  | "research-services"
  | "hackathons"
  | "innovations";

export interface ResearchInnovationTabDef {
  key: ResearchInnovationTabKey;
  label: string;
}

// Research Profiles comes first - it's the researcher's own identifying IDs
// (ORCID/Scopus/etc.) and citation metrics, which the other tabs' content
// (publications, projects, etc.) is naturally attributed against.
export const RESEARCH_INNOVATION_TABS: ResearchInnovationTabDef[] = [
  { key: "research-profiles", label: "Research Profiles" },
  { key: "citations", label: "Citations & H-Index Growth" },
  { key: "publications", label: "Research Publications" },
  { key: "discovery-innovation", label: "Discovery & Innovation (IPR)" },
  { key: "sponsored-projects", label: "Sponsored Research Projects" },
  { key: "seed-funding", label: "Seed Funding" },
  { key: "consultancy-projects", label: "Consultancy Projects" },
  { key: "phd-supervision", label: "Ph.D. Supervision" },
  { key: "research-services", label: "Research Services & Contributions" },
  { key: "hackathons", label: "Organizing Hackathons / Competitions" },
  { key: "innovations", label: "Innovations" },
];
