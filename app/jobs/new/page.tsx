import { addManualJob } from "../../actions";
import { listCompanies } from "../../../lib/queries";
import { WORKPLACE_TYPES } from "../../../lib/types";

export default async function NewJobPage() {
  const companies = await listCompanies();

  return (
    <>
      <h1>Add a job</h1>
      <p className="lede">
        For postings I found myself, so the tracker covers everything and not only what discovery
        picks up.
      </p>

      <form action={addManualJob} className="panel">
        <div className="field">
          <label htmlFor="companyId">Company</label>
          <select id="companyId" name="companyId" defaultValue="">
            <option value="" disabled>
              Pick one, or name a new company below
            </option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.city ? ` \u2014 ${c.city}` : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="row">
          <div className="field">
            <label htmlFor="newCompany">New company (overrides the list)</label>
            <input type="text" id="newCompany" name="newCompany" />
          </div>
          <div className="field">
            <label htmlFor="newCompanyCity">Its city</label>
            <input type="text" id="newCompanyCity" name="newCompanyCity" />
          </div>
        </div>

        <div className="field">
          <label htmlFor="title">Role title</label>
          <input type="text" id="title" name="title" required />
        </div>

        <div className="field">
          <label htmlFor="url">Posting URL</label>
          <input type="url" id="url" name="url" required />
        </div>

        <div className="row">
          <div className="field">
            <label htmlFor="location">Location</label>
            <input type="text" id="location" name="location" />
          </div>
          <div className="field">
            <label htmlFor="workplaceType">Workplace</label>
            <select id="workplaceType" name="workplaceType" defaultValue="">
              <option value="">Unknown</option>
              {WORKPLACE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="postedAt">Posted on</label>
            <input type="date" id="postedAt" name="postedAt" />
          </div>
        </div>

        <div className="field">
          <label htmlFor="description">Description (paste it, scoring reads this later)</label>
          <textarea id="description" name="description" rows={10} />
        </div>

        <div className="field">
          <label>
            <input type="checkbox" name="track" defaultChecked /> Start an application right away
          </label>
        </div>

        <button type="submit" className="primary">
          Save
        </button>
      </form>
    </>
  );
}
