import { addManualJob } from "../../actions";
import { SubmitButton } from "../../components/client-ui";
import { DbUnavailable, PageHeader } from "../../components/ui";
import { listCompanies } from "../../../lib/queries";
import { WORKPLACE_TYPES } from "../../../lib/types";

export const metadata = { title: "Ajouter une offre" };

export default async function NewJobPage() {
  let companies;
  try {
    companies = await listCompanies();
  } catch (err) {
    return (
      <>
        <PageHeader eyebrow="Ajout manuel" title="Ajouter une offre" />
        <DbUnavailable detail={(err as Error).message} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Ajout manuel"
        title="Ajouter une offre"
        lede="Pour les postings que tu as trouvés toi-même, afin que le tracker couvre tout — pas seulement ce que la découverte automatique ramasse."
      />

      <form action={addManualJob} className="panel">
        <div className="field">
          <label htmlFor="companyId">Entreprise</label>
          <select id="companyId" name="companyId" defaultValue="">
            <option value="" disabled>
              Choisis-en une, ou nomme une nouvelle entreprise ci-dessous
            </option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.city ? ` — ${c.city}` : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="row">
          <div className="field">
            <label htmlFor="newCompany">Nouvelle entreprise (remplace la liste)</label>
            <input type="text" id="newCompany" name="newCompany" />
          </div>
          <div className="field">
            <label htmlFor="newCompanyCity">Sa ville</label>
            <input type="text" id="newCompanyCity" name="newCompanyCity" />
          </div>
        </div>

        <div className="field">
          <label htmlFor="title">Titre du poste</label>
          <input type="text" id="title" name="title" required />
        </div>

        <div className="field">
          <label htmlFor="url">URL de l&apos;offre</label>
          <input type="url" id="url" name="url" required placeholder="https://…" />
        </div>

        <div className="row">
          <div className="field">
            <label htmlFor="location">Lieu</label>
            <input type="text" id="location" name="location" />
          </div>
          <div className="field">
            <label htmlFor="workplaceType">Sur place / à distance</label>
            <select id="workplaceType" name="workplaceType" defaultValue="">
              <option value="">Inconnu</option>
              {WORKPLACE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="postedAt">Publiée le</label>
            <input type="date" id="postedAt" name="postedAt" />
          </div>
        </div>

        <div className="field">
          <label htmlFor="description">Description (colle-la, le score la lira plus tard)</label>
          <textarea id="description" name="description" rows={10} />
        </div>

        <label className="check-plain">
          <input type="checkbox" name="track" defaultChecked />
          Démarrer une candidature tout de suite
        </label>

        <div className="form-actions">
          <SubmitButton className="primary" pendingLabel="Enregistrement…">
            Enregistrer
          </SubmitButton>
        </div>
      </form>
    </>
  );
}
