// The Research & Innovation module's own sub-tabs (see
// ResearchInnovationModule) - Research Publications is the only one with real
// fields so far (the R&D-managed publication list + self-reported
// bibliometrics, same content this module always had); the rest are
// scaffolded empty for now, one field set to be built out later at a time.
export type ResearchInnovationTabKey =
  | "publications"
  | "discovery-innovation"
  | "sponsored-projects"
  | "seed-funding"
  | "consultancy-projects"
  | "phd-supervision"
  | "research-services"
  | "research-profiles"
  | "hackathons"
  | "innovations";

export interface ResearchInnovationTabDef {
  key: ResearchInnovationTabKey;
  label: string;
}

export const RESEARCH_INNOVATION_TABS: ResearchInnovationTabDef[] = [
  { key: "publications", label: "Research Publications" },
  { key: "discovery-innovation", label: "Discovery & Innovation (IPR)" },
  { key: "sponsored-projects", label: "Sponsored Research Projects" },
  { key: "seed-funding", label: "Seed Funding" },
  { key: "consultancy-projects", label: "Consultancy Projects" },
  { key: "phd-supervision", label: "Ph.D. Supervision" },
  { key: "research-services", label: "Research Services & Contributions" },
  { key: "research-profiles", label: "Research Profiles" },
  { key: "hackathons", label: "Organizing Hackathons / Competitions" },
  { key: "innovations", label: "Innovations" },
];
