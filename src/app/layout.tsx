import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import AppProviders from "@/components/AppProviders";
import StagingBanner from "@/components/StagingBanner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Cryple - Secure Your Data",
  description: "Securely store and manage your sensitive data with Cryple.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const isStaging = process.env.NEXT_PUBLIC_ENV === "development";

  return (
    <html lang="en" data-staging={isStaging ? "" : undefined}>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <StagingBanner />
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
