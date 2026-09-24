"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { analyzeJobUrl, previewJobMatch, type JobMatchPreview } from "../../actions";
import { Select, Switch } from "../../components/client-ui";
import { Combobox } from "../../components/combobox";
import { IconBuilding, IconLink, IconSpark } from "../../components/icons";
import { SubmitButton } from "../../components/client-ui";
import type { Company } from "../../../lib/types";

const WORKPLACE_LABEL: Record<string, string> = {
  onsite: "Sur place",
  hybrid: "Hybride",
  remote: "À distance",
};

const BAND_RING: Record<string, string> = {
  high: "var(--good)",
  mid: "var(--slate)",
  ok: "var(--amber)",
  low: "var(--ink-3)",
  skip: "var(--clay)",
};

function domainOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

function CompanyLogo({ name, domain, size = "" }: { name: string; domain: string | null; size?: "lg" | "" }) {
  const [failed, setFailed] = useState(false);
  const src = domain ? `https://logo.clearbit.com/${domain}?size=128` : null;

  return (
    <span className={`company-logo ${size}`.trim()}>
      {src && !failed ? (
        // Third-party favicon service, not project-owned assets — a plain <img> is correct here.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" onError={() => setFailed(true)} />
      ) : (
        <span aria-hidden="true">{initialsOf(name || "?")}</span>
      )}
    </span>
  );
}

export function JobComposer({
  companies,
  workplaceTypes,
  addManualJob,
}: {
  companies: Company[];
  workplaceTypes: readonly string[];
  addManualJob: (form: FormData) => void | Promise<void>;
}) {
  const [companyId, setCompanyId] = useState("");
  const [newCompanyName, setNewCompanyName] = useState("");
  const [newCompanyCity, setNewCompanyCity] = useState("");

  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [location, setLocation] = useState("");
  const [workplaceType, setWorkplaceType] = useState("");
  const [description, setDescription] = useState("");

  const [analyzing, setAnalyzing] = useState(false);
  const [analyzedHost, setAnalyzedHost] = useState<string | null>(null);
  const [analysisNote, setAnalysisNote] = useState<string | null>(null);
  const lastAnalyzedUrl = useRef<string | null>(null);

  const [match, setMatch] = useState<JobMatchPreview | null>(null);

  const options = useMemo(
    () => companies.map((c) => ({ value: c.id, label: c.name, hint: c.city ?? undefined })),
    [companies],
  );
  const selectedCompany = companies.find((c) => c.id === companyId) ?? null;
  const isNewCompany = !companyId && newCompanyName.length > 0;
  const companyName = selectedCompany?.name ?? newCompanyName;
  const logoDomain = domainOf(selectedCompany?.website) ?? analyzedHost;

  async function runAnalysis(candidate: string) {
    if (!candidate || candidate === lastAnalyzedUrl.current) return;
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      return;
    }
    lastAnalyzedUrl.current = candidate;
    setAnalyzing(true);
    setAnalysisNote(null);
    try {
      const result = await analyzeJobUrl(parsed.toString());
      setAnalyzedHost(result.hostname);
      if (!result.ok) {
        setAnalysisNote(
          result.error
            ? "Impossible d'analyser automatiquement, remplis les champs toi-même."
            : "Rien d'exploitable trouvé sur cette page, remplis les champs toi-même.",
        );
        return;
      }
      const filled: string[] = [];
      if (result.title && !title.trim()) {
        setTitle(result.title);
        filled.push("titre");
      }
      if (result.description && !description.trim()) {
        setDescription(result.description);
        filled.push("description");
      }
      if (result.location && !location.trim()) {
        setLocation(result.location);
        filled.push("lieu");
      }
      setAnalysisNote(
        filled.length > 0
          ? `Analysé : ${filled.join(", ")} pré-rempli${filled.length > 1 ? "s" : ""}. Vérifie avant d'enregistrer.`
          : "Analysé : rien à pré-remplir de plus.",
      );
    } catch {
      setAnalysisNote("L'analyse a échoué, remplis les champs toi-même.");
    } finally {
      setAnalyzing(false);
    }
  }

  // Debounced live match preview: recompute shortly after the visitor stops
  // typing in any field the scorer actually reads.
  useEffect(() => {
    const t = setTimeout(() => {
      if (!title.trim() && !description.trim()) {
        setMatch(null);
        return;
      }
      previewJobMatch({ title, location, workplaceType, description })
        .then(setMatch)
        .catch(() => setMatch(null));
    }, 450);
    return () => clearTimeout(t);
  }, [title, location, workplaceType, description]);

  const band = match ? (match.gated ? "skip" : match.band) : null;
  const ringPct = match ? (match.gated ? 100 : match.percent) : 0;

  return (
    <div className="split">
      <form action={addManualJob} className="panel stack" style={{ gap: 0 }}>
        <input type="hidden" name="companyId" value={companyId} />
        <input type="hidden" name="newCompany" value={isNewCompany ? newCompanyName : ""} />
        <input type="hidden" name="newCompanyCity" value={isNewCompany ? newCompanyCity : ""} />

        <div className="field">
          <label htmlFor="company-combobox">Entreprise</label>
          <Combobox
            options={options}
            value={companyId}
            onChange={(id) => {
              setCompanyId(id);
              setNewCompanyName("");
            }}
            placeholder="Chercher une entreprise…"
            emptyLabel="Aucune entreprise ne correspond"
            allowCreate
            createLabel={(q) => `Ajouter « ${q} » comme nouvelle entreprise`}
            onCreate={(q) => {
              setNewCompanyName(q);
              setCompanyId("");
            }}
            renderTrigger={() =>
              companyName ? (
                <>
                  <CompanyLogo name={companyName} domain={logoDomain} />
                  {companyName}
                  {isNewCompany ? <span className="badge neutral">nouvelle</span> : null}
                </>
              ) : null
            }
          />
        </div>

        {isNewCompany ? (
          <div className="field">
            <label htmlFor="newCompanyCityField">
              Ville de {newCompanyName} <span className="optional">(optionnel)</span>
            </label>
            <input
              type="text"
              id="newCompanyCityField"
              value={newCompanyCity}
              onChange={(e) => setNewCompanyCity(e.target.value)}
              placeholder="Montréal"
            />
          </div>
        ) : null}

        <div className="field">
          <label htmlFor="url">URL de l&apos;offre</label>
          <input
            type="url"
            id="url"
            name="url"
            required
            placeholder="https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={(e) => runAnalysis(e.target.value.trim())}
          />
          {analyzing ? (
            <span className="field-hint">
              <span className="mono">↻</span> Analyse de la page en cours…
            </span>
          ) : analysisNote ? (
            <span className="field-hint">
              <IconSpark className="mono" style={{ width: 12, height: 12, verticalAlign: "-1px" }} />{" "}
              {analysisNote}
            </span>
          ) : (
            <span className="field-hint">Colle le lien : le titre et la description se pré-remplissent quand c&apos;est possible.</span>
          )}
        </div>

        <div className="field">
          <label htmlFor="title">Titre du poste</label>
          <input
            type="text"
            id="title"
            name="title"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div className="row">
          <div className="field">
            <label htmlFor="location">Lieu</label>
            <input
              type="text"
              id="location"
              name="location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="workplaceType">Sur place / à distance</label>
            <Select
              name="workplaceType"
              ariaLabel="Sur place ou à distance"
              placeholder="Inconnu"
              defaultValue=""
              onValueChange={setWorkplaceType}
              options={[
                { value: "", label: "Inconnu" },
                ...workplaceTypes.map((t) => ({ value: t, label: WORKPLACE_LABEL[t] ?? t })),
              ]}
            />
          </div>
          <div className="field">
            <label htmlFor="postedAt">Publiée le</label>
            <input type="date" id="postedAt" name="postedAt" />
          </div>
        </div>

        <div className="field">
          <label htmlFor="description">
            Description <span className="optional">(un extrait suffit, le score la relira au complet plus tard)</span>
          </label>
          <textarea
            id="description"
            name="description"
            className="compact"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <Switch name="track" id="track" defaultChecked label="Démarrer une candidature tout de suite" />

        <div className="form-actions">
          <SubmitButton className="primary large" pendingLabel="Enregistrement…">
            Enregistrer l&apos;offre
          </SubmitButton>
        </div>
      </form>

      <aside className="split-aside">
        <div className="panel panel-raised">
          <div className="panel-head">
            <span className="panel-title">Aperçu</span>
            {analyzedHost ? (
              <span className="badge neutral">
                <IconLink style={{ width: 11, height: 11 }} />
                {analyzedHost}
              </span>
            ) : null}
          </div>

          {!title.trim() && !companyName ? (
            <p className="preview-empty">Choisis une entreprise ou saisis un titre pour voir l&apos;aperçu.</p>
          ) : (
            <div className="stack reveal-in" style={{ gap: "var(--s-4)" }}>
              <div className="cluster" style={{ gap: "var(--s-3)", alignItems: "flex-start" }}>
                <CompanyLogo name={companyName || "?"} domain={logoDomain} size="lg" />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: "var(--ink-0)", fontSize: "1.02rem", lineHeight: 1.3 }}>
                    {title.trim() || <span className="empty">Titre du poste…</span>}
                  </div>
                  <div className="small muted" style={{ marginTop: "0.2rem" }}>
                    {companyName || "Entreprise à préciser"}
                    {location ? ` · ${location}` : ""}
                    {workplaceType ? ` · ${WORKPLACE_LABEL[workplaceType] ?? workplaceType}` : ""}
                  </div>
                </div>
              </div>

              <div
                key={match ? "match" : "no-match"}
                className="cluster reveal-in"
                style={{ justifyContent: "space-between", padding: "var(--s-3) 0", borderTop: "1px solid var(--line)" }}
              >
                <div>
                  <div className="small muted">Correspondance CV</div>
                  <div style={{ fontSize: "0.78rem", color: "var(--ink-3)", marginTop: "0.15rem" }}>
                    {match
                      ? match.gated
                        ? "Écartée (lieu ou période)"
                        : `Bande ${match.band}`
                      : "Ajoute un titre pour estimer"}
                  </div>
                </div>
                <div
                  className={`match-ring`}
                  style={
                    {
                      "--pct": ringPct,
                      "--ring-color": band ? BAND_RING[band] : "var(--ink-3)",
                    } as React.CSSProperties
                  }
                >
                  <span className="match-ring-value">{match ? (match.gated ? "—" : match.percent) : "—"}</span>
                </div>
              </div>

              <div key={match && match.skills.length > 0 ? "skills" : "no-skills"} className="reveal-in">
                <div className="small muted" style={{ marginBottom: "var(--s-2)" }}>
                  Compétences détectées
                </div>
                {match && match.skills.length > 0 ? (
                  <p className="tag-list" style={{ margin: 0 }}>
                    {match.skills.slice(0, 14).map((s) => (
                      <span key={s.name} className={`badge ${s.have ? "green" : "neutral"}`}>
                        {s.have ? <span className="dot" aria-hidden="true" /> : null}
                        {s.name}
                      </span>
                    ))}
                  </p>
                ) : (
                  <p className="small muted" style={{ margin: 0 }}>
                    {title.trim() || description.trim()
                      ? "Aucune compétence du dictionnaire détectée."
                      : "Apparaissent une fois le titre ou la description remplis."}
                  </p>
                )}
              </div>

              {!selectedCompany && !isNewCompany ? (
                <p className="field-hint" style={{ margin: 0 }}>
                  <IconBuilding style={{ width: 12, height: 12, verticalAlign: "-1px" }} /> Choisis une
                  entreprise existante ou tape un nom pour en créer une.
                </p>
              ) : null}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
