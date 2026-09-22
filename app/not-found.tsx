import Link from "next/link";
import { PageHeader } from "./components/ui";

export default function NotFound() {
  return (
    <>
      <PageHeader
        eyebrow="404"
        title="Rien à cet endroit"
        lede="La fiche a peut-être été supprimée, ou le lien est incomplet."
      />
      <div className="cluster">
        <Link href="/" className="btn primary">
          Voir les offres
        </Link>
        <Link href="/pipeline" className="btn">
          Ouvrir le pipeline
        </Link>
      </div>
    </>
  );
}
