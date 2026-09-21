import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Internship Desk",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <span className="brand">Internship Desk</span>
          <nav>
            <Link href="/">Jobs</Link>
            <Link href="/board">Board</Link>
            <Link href="/followups">Follow-ups</Link>
            <Link href="/answers">Answers</Link>
            <Link href="/jobs/new">Add a job</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
