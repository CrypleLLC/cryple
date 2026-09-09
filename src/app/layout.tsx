import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import AppProviders from "@/components/AppProviders";
import StagingBanner from "@/components/StagingBanner";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
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
        className={`${inter.variable} ${jetbrainsMono.variable} antialiased`}
      >
        <StagingBanner />
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
