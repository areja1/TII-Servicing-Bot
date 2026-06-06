import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TII Servicing Assistant",
  description:
    "Travel Insured International servicing assistant — answers grounded in your Confirmation of Benefits and FlexiPAX Plan Document.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
