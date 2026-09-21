import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export const metadata: Metadata = {
  title: "Terms of Service | Thai Property AI",
  description:
    "Terms of Service for the Thai Property AI warehouse and storage planning application.",
  robots: { index: true, follow: true },
};

export default async function Page({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <>
      <h1>Terms of Service</h1>
      <p>Last updated: September 21, 2026</p>
      <p>
        These terms apply to the Thai Property AI warehouse and storage planning
        application at{" "}
        <a href="https://app.thaipropertyai.com">app.thaipropertyai.com</a>.
        Questions can be sent to{" "}
        <a href="mailto:rugbykritsakorn@gmail.com">rugbykritsakorn@gmail.com</a>
        . By using the application, you agree to these terms. If you use it for
        an organization, you must be authorized to do so.
      </p>
      <h2>Accounts and authorized use</h2>
      <p>
        Provide accurate account information, protect your sign-in credentials
        and use only the organizations, warehouses and records you are
        authorized to access. Your organization controls your membership and
        permissions. Notify us if you believe your account or the service has
        been misused.
      </p>
      <p>
        Do not use the service unlawfully, upload material you have no right to
        use, bypass access controls, interfere with other users, introduce
        malicious software or attempt unauthorized access to data or systems.
      </p>
      <h2>Your records</h2>
      <p>
        You and your organization retain your rights in information submitted to
        the service. You permit us and our service providers to host, process
        and display it as needed to provide, secure and support the service. You
        are responsible for the accuracy of submitted information and for having
        the permissions needed to provide it, including any personal information
        about other people.
      </p>
      <p>
        Our <Link href="/privacy">Privacy Policy</Link> explains how personal
        information is handled. Contact us about requests concerning your
        records. Removing an account or organization membership does not
        automatically delete historical operational or audit records.
      </p>
      <h2>Warehouse decisions</h2>
      <p>
        The application supports recordkeeping and planning. Verify
        measurements, quantities, locations, scan results and planned movements
        before acting on them. Layouts and visualizations do not certify
        structural capacity, safe stacking, load limits, regulatory compliance
        or suitability for a particular site. Your organization remains
        responsible for qualified supervision, workplace safety and physical
        operations.
      </p>
      <h2>Availability and third-party services</h2>
      <p>
        Features may change, and the service may be interrupted for maintenance,
        errors or circumstances outside our control. Authentication, hosting and
        backend services depend on third-party providers, whose own terms may
        also apply to your use of their services. Keep any independent records
        your business needs.
      </p>
      <p>
        To the extent permitted by applicable law, the service is provided as
        available, without a promise of uninterrupted or error-free operation or
        fitness for a particular purpose. Nothing in these terms excludes
        rights, remedies or responsibilities that cannot lawfully be excluded.
      </p>
      <h2>Suspension and ending use</h2>
      <p>
        You may stop using the service at any time. Your organization may remove
        your access. We may restrict access where reasonably necessary to
        address misuse, security threats, unlawful activity or violations of
        these terms. Contact us about access or data requests when ending use;
        data handling is described in the Privacy Policy.
      </p>
      <h2>Changes and contact</h2>
      <p>
        We may update these terms as the service changes. We will display the
        updated date and communicate material changes as required by applicable
        law. For questions about the service or these terms, email{" "}
        <a href="mailto:rugbykritsakorn@gmail.com">rugbykritsakorn@gmail.com</a>
        .
      </p>
    </>
  );
}
