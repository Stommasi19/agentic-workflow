import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Bridge UI — Agent Conversations",
  description: "Visualize agent-to-agent interactions via the MCP bridge",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} bg-zinc-950 text-zinc-100 min-h-screen`}>
        <header className="border-b border-zinc-800 px-6 py-3">
          <a href="/" className="text-lg font-semibold text-zinc-100 hover:text-white">
            Bridge UI
          </a>
        </header>
        <main className="max-w-7xl mx-auto px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
