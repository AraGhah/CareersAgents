import type { MessageClassification } from "./classify";
import type { RoleCategory } from "./category";
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

export const MESSAGE_CLASSIFICATION_FR: Record<MessageClassification, string> = {
  confirmation: "Confirmation",
  rejection: "Refus",
  interview: "Entrevue",
  assessment: "Évaluation",
  offer: "Offre",
  other: "Autre",
};

export const ROLE_CATEGORY_LABEL_FR: Record<RoleCategory, string> = {
  backend: "Back-end",
  fullstack: "Full-stack",
  cloud: "Cloud",
  ai: "IA / ML",
  gamedev: "Jeux vidéo",
};

export const BAND_LABEL_FR: Record<Band, string> = {
  high: "Priorité (85+)",
  mid: "Postuler (70 à 84)",
  ok: "À revoir (60 à 69)",
  low: "Sous 60",
  skip: "Rejeté (lieu ou période)",
};

export const LANG_LABEL_FR: Record<"en" | "fr", string> = {
  en: "Anglais",
  fr: "Français",
};

export const COMPONENT_LABEL_FR: Record<string, string> = {
  skills: "Compétences",
  location: "Lieu",
  timing: "Période",
  language: "Langue",
  level: "Niveau",
};
