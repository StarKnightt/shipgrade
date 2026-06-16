import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import PendoInitializer from "./components/PendoInitializer";

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
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(apiKey){
    (function(p,e,n,d,o){var v,w,x,y,z;o=p[d]=p[d]||{};o._q=o._q||[];
    v=['initialize','identify','updateOptions','pageLoad','track','trackAgent'];for(w=0,x=v.length;w<x;++w)(function(m){
    o[m]=o[m]||function(){o._q[m===v[0]?'unshift':'push']([m].concat([].slice.call(arguments,0)));};})(v[w]);
    y=e.createElement(n);y.async=!0;y.src='https://cdn.pendo.io/agent/static/'+apiKey+'/pendo.js';
    z=e.getElementsByTagName(n)[0];z.parentNode.insertBefore(y,z);})(window,document,'script','pendo');
})('e89091f9-ed17-4d2b-ba78-db6704db8e51');`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <PendoInitializer />
        {children}
      </body>
    </html>
  );
}
