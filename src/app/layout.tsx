import type { Metadata } from "next";
import "./globals.css";

// Demo steps run matching and messaging in one server action; allow up to 60s.
export const maxDuration = 60;

export const metadata: Metadata = {
  title: "우연한 식탁",
  description: "매주 목요일 저녁, 처음 보는 사람들과 좋은 저녁 한 끼",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
