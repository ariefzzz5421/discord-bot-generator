import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Discord Bot Generator using AI",
  description:
    "Describe a bot, pick its skills, feed it a knowledge base, and download a working discord.js project with a RAG-powered mind.",
};

export const viewport: Viewport = {
  themeColor: "#08070d",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <div className="shell topbar-inner">
            <Link href="/" className="brand">
              <span className="brand-mark" aria-hidden>
                ◆
              </span>
              <span>
                Bot<span style={{ color: "var(--text-faint)" }}>Forge</span>
              </span>
            </Link>
            <nav className="topbar-links">
              <Link href="/#skills" className="btn btn-ghost btn-sm">
                Skills
              </Link>
              <Link href="/#how" className="btn btn-ghost btn-sm">
                How it works
              </Link>
              <Link href="/builder" className="btn btn-primary btn-sm">
                Open the studio
              </Link>
            </nav>
          </div>
        </header>

        <main>{children}</main>

        <footer className="footer">
          <div className="shell" style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <span>Discord Bot Generator using AI — generates discord.js v14 projects.</span>
            <span>Built with Claude · your code, your keys, no runtime lock-in.</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
