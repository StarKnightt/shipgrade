import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import PendoInitializer from "./components/PendoInitializer";

const cabinet = localFont({
  variable: "--font-cabinet",
  src: "./fonts/CabinetGrotesk-Variable.woff2",
  weight: "100 900",
  display: "swap",
});

const switzer = localFont({
  variable: "--font-switzer",
  src: [
    { path: "./fonts/Switzer-Variable.woff2", weight: "100 900", style: "normal" },
    { path: "./fonts/Switzer-VariableItalic.woff2", weight: "100 900", style: "italic" },
  ],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const title = "Shipgrade: Grade your product page in 30 seconds";
const description =
  "Paste your product or SaaS page and get a ruthless, specific critique across value prop, audience, differentiation, CTA, trust, craft, and checkout. Graded in about 30 seconds.";

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
      className={`${cabinet.variable} ${switzer.variable} ${geistMono.variable} h-full antialiased`}
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
