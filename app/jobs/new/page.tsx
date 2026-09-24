import { addManualJob } from "../../actions";
import { DbUnavailable, PageHeader } from "../../components/ui";
import { listCompanies } from "../../../lib/queries";
import { WORKPLACE_TYPES } from "../../../lib/types";
import { JobComposer } from "./composer";

export const metadata = { title: "Ajouter une offre" };

export default async function NewJobPage() {
  let companies;
  try {
    companies = await listCompanies();
  } catch (err) {
    return (
      <>
        <PageHeader title="Ajouter une offre" />
        <DbUnavailable detail={(err as Error).message} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Ajouter une offre"
      />

      <JobComposer companies={companies} workplaceTypes={WORKPLACE_TYPES} addManualJob={addManualJob} />
    </>
  );
}
