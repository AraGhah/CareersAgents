import type { ApplicationStatus } from "./types";
import type { Band } from "./score";

export const APPLICATION_STATUS_FR: Record<ApplicationStatus, string> = {
  discovered: "Découvert",
  qualified: "Qualifié",
  ready: "Prêt",
  applied: "Postulé",
  followup: "Relance",
  interview: "Entrevue",
  accepted: "Accepté",
  rejected: "Refusé",
  withdrawn: "Abandonné",
};

export const BAND_LABEL_FR: Record<Band, string> = {
  high: "Priorité (85+)",
  mid: "Postuler (70 à 84)",
  ok: "À revoir (60 à 69)",
  low: "Sous 60",
  skip: "Rejeté (lieu ou période)",
};

export const COMPONENT_LABEL_FR: Record<string, string> = {
  skills: "Compétences",
  location: "Lieu",
  timing: "Période",
  language: "Langue",
  level: "Niveau",
};
