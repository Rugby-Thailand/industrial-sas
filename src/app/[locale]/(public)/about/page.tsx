import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export const metadata: Metadata = {
  title: "About | Thai Property AI",
  description: "Warehouse and storage planning for authorized business teams.",
  robots: { index: true, follow: true },
};

export default async function AboutPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <>
      <h1>Warehouse and storage planning</h1>
      <p>
        Thai Property AI helps authorized business teams plan storage layouts
        and keep warehouse records together. The application at
        app.thaipropertyai.com supports buildings, floors, storage locations,
        products, packing, pallets and warehouse movements.
      </p>
      <h2>Work with your organization</h2>
      <p>
        Sign in to access the organizations and warehouses your administrator
        has authorized. Teams can record package dimensions and quantities, view
        storage layouts, scan package and location codes, and track operational
        actions.
      </p>
      <h2>Google sign-in</h2>
      <p>
        You can use Google to sign in through Clerk. We request basic identity,
        email and profile information to establish your account. We do not
        request access to Gmail messages, Google Drive files or Google Calendar.
      </p>
      <h2>Privacy and terms</h2>
      <p>
        Read our <Link href="/privacy">Privacy Policy</Link> for information
        about account data, operational records and your choices. Our{" "}
        <Link href="/terms">Terms of Service</Link> explain the responsibilities
        that apply when using the application.
      </p>
      <h2>Contact</h2>
      <p>
        For service or privacy questions, email{" "}
        <a href="mailto:rugbykritsakorn@gmail.com">rugbykritsakorn@gmail.com</a>
        .
      </p>
      <p>
        <Link href="/sign-in">Sign in to Thai Property AI</Link>
      </p>
    </>
  );
}
