"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { analyzeJobUrl, previewJobMatch, type JobMatchPreview } from "../../actions";
import { Select, Switch } from "../../components/client-ui";
import { Combobox } from "../../components/combobox";
import { IconBuilding, IconLink } from "../../components/icons";
import { CompanyTile } from "../../components/company-tile";
import { SubmitButton } from "../../components/client-ui";
import { WORKPLACE_LABEL_FR } from "../../../lib/format";
import { BAND_LABEL_FR } from "../../../lib/status-labels";
import type { Band } from "../../../lib/score";
import type { Company } from "../../../lib/types";

const BAND_RING: Record<string, string> = {
  high: "var(--good)",
  mid: "var(--slate)",
  ok: "var(--amber)",
  low: "var(--ink-3)",
  skip: "var(--clay)",
};

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
  const ringPct = match ? (match.gated ? 0 : match.percent) : 0;

  return (
    <div className="split">
      <form action={addManualJob} className="panel stack form-tight">
        <input type="hidden" name="companyId" value={companyId} />
        <input type="hidden" name="newCompany" value={isNewCompany ? newCompanyName : ""} />
        <input type="hidden" name="newCompanyCity" value={isNewCompany ? newCompanyCity : ""} />

        <div className="field">
          <label htmlFor="company-combobox">Entreprise</label>
          <Combobox
            id="company-combobox"
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
                  <CompanyTile name={companyName} size="sm" />
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
              Analyse de la page en cours…
            </span>
          ) : analysisNote ? (
            <span className="field-hint">{analysisNote}</span>
          ) : (
            <span className="field-hint">Le titre et la description sont repris de la page quand c&apos;est possible.</span>
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
              id="workplaceType"
              name="workplaceType"
              ariaLabel="Sur place ou à distance"
              placeholder="Inconnu"
              defaultValue=""
              onValueChange={setWorkplaceType}
              options={[
                { value: "", label: "Inconnu" },
                ...workplaceTypes.map((t) => ({ value: t, label: WORKPLACE_LABEL_FR[t] ?? t })),
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
            Description <span className="optional">(un extrait suffit)</span>
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
                <IconLink className="icon-inline" />
                {analyzedHost}
              </span>
            ) : null}
          </div>

          {!title.trim() && !companyName ? (
            <p className="preview-empty">Choisis une entreprise ou saisis un titre pour voir l&apos;aperçu.</p>
          ) : (
            <div className="stack reveal-in preview-body">
              <div className="cluster preview-head">
                <CompanyTile name={companyName || "?"} />
                <div className="preview-title-block">
                  <div className="preview-title">
                    {title.trim() || <span className="empty">Titre du poste…</span>}
                  </div>
                  <div className="small muted preview-meta">
                    {companyName || "Entreprise à préciser"}
                    {location ? ` · ${location}` : ""}
                    {workplaceType ? ` · ${WORKPLACE_LABEL_FR[workplaceType] ?? workplaceType}` : ""}
                  </div>
                </div>
              </div>

              <div
                key={match ? "match" : "no-match"}
                className="cluster reveal-in preview-match"
              >
                <div>
                  <div className="small muted">Correspondance CV</div>
                  <div className="preview-match-note">
                    {match
                      ? match.gated
                        ? "Écartée (lieu ou période)"
                        : BAND_LABEL_FR[(match.band as Band) ?? "low"] ?? match.band
                      : "Ajoute un titre pour estimer"}
                  </div>
                </div>
                <div
                  className="match-ring"
                  style={
                    {
                      "--pct": ringPct,
                      "--ring-color": band ? BAND_RING[band] : "var(--ink-3)",
                    } as React.CSSProperties
                  }
                >
                  <span className="match-ring-value">{match ? (match.gated ? "n/d" : match.percent) : "n/d"}</span>
                </div>
              </div>

              <div key={match && match.skills.length > 0 ? "skills" : "no-skills"} className="reveal-in">
                <div className="small muted preview-skills-label">Compétences détectées</div>
                {match && match.skills.length > 0 ? (
                  <p className="tag-list flush">
                    {match.skills.slice(0, 14).map((s) => (
                      <span key={s.name} className={`badge ${s.have ? "green" : "neutral"}`}>
                        {s.name}
                      </span>
                    ))}
                  </p>
                ) : (
                  <p className="small muted flush">
                    {title.trim() || description.trim()
                      ? "Aucune compétence du dictionnaire détectée."
                      : "Apparaissent une fois le titre ou la description remplis."}
                  </p>
                )}
              </div>

              {!selectedCompany && !isNewCompany ? (
                <p className="field-hint flush">
                  <IconBuilding className="icon-inline" /> Choisis une entreprise existante ou tape un
                  nom pour en créer une.
                </p>
              ) : null}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
