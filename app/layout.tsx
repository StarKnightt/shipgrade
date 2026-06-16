import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const title = "Shipgrade — Grade your product page in 30 seconds";
const description =
  "Paste any product URL and get a ruthless, specific product critique: value prop, audience, differentiation, CTA, trust, and craft — graded instantly.";

export const metadata: Metadata = {
  metadataBase: new URL("https://shipgrade.app"),
  title,
  description,
  applicationName: "Shipgrade",
  keywords: [
    "product critique",
    "landing page review",
    "value proposition",
    "product thinking",
    "shipgrade",
  ],
  openGraph: {
    title,
    description,
    siteName: "Shipgrade",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
