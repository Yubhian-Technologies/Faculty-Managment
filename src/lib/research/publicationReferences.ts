import type { PublicationIndex } from "@/types";

// Reference links the publication form shows beside Indexed / Quartile /
// Impact Factor - the sites a submitter is told to look their value up on.
//
// Shared rather than private to the form because R&D needs the same links when
// verifying: checking that a paper really is Scopus-indexed, or that the
// declared impact factor matches, means opening the same source the submitter
// was pointed at. Two copies would drift the moment one is updated.

export const INDEX_LABELS: Record<PublicationIndex, string> = {
  SCOPUS: "Scopus", WOS_ESCI: "WoS-ESCI", WOS_SCIE: "WoS-SCIE", WOS: "WoS",
};

export const INDEX_REFERENCE_URLS: Record<PublicationIndex, string> = {
  SCOPUS: "https://www.scopus.com", WOS_ESCI: "https://mjl.clarivate.com/home",
  WOS_SCIE: "https://mjl.clarivate.com/home", WOS: "https://mjl.clarivate.com/home",
};

export const QUARTILE_REFERENCE_URL = "https://www.scimagojr.com/";
export const IMPACT_FACTOR_REFERENCE_URL = "https://www.bioxbio.com/";
