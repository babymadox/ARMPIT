import "./globals.css";
export const metadata = { title: "ARMPIT", description: "The workspace for affiliate managers" };
export default function Root({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
