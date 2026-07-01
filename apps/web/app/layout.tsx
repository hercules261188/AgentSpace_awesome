import type { Metadata } from "next";
import type { ReactNode } from "react";
import { LanguageProvider } from "@/features/i18n/language-provider";
import { FeedbackToastProvider } from "@/shared/ui/feedback-toast-provider";
import "./globals.css";

const configuredLanguage = process.env.AGENTSPACE_UI_LANGUAGE;
const initialLanguage = configuredLanguage === "en" || configuredLanguage === "zh" ? configuredLanguage : "zh";

export const metadata: Metadata = {
  title: {
    default: "AgentSpace",
    template: "%s | AgentSpace",
  },
  description:
    "AgentSpace workspace rebuilt around a Multica-inspired Inbox and Agents dashboard.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang={initialLanguage === "zh" ? "zh-CN" : "en"} suppressHydrationWarning>
      <body>
        <LanguageProvider initialLanguage={initialLanguage}>
          <FeedbackToastProvider>{children}</FeedbackToastProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
