import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Claude Model Comparison - Medical Notes",
  description: "Compare Claude model outputs for medical note analysis",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
