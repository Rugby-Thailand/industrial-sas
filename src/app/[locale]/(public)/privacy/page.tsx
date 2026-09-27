import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";

export const metadata: Metadata = {
  title: "Privacy Policy | Thai Property AI",
  description:
    "Privacy Policy for the Thai Property AI warehouse and storage planning application.",
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
      <h1>Privacy Policy</h1>
      <p>Last updated: September 21, 2026</p>
      <p>
        Thai Property AI provides the warehouse and storage planning application
        at <a href="https://app.thaipropertyai.com">app.thaipropertyai.com</a>.
        This policy explains how information is handled when you sign in and use
        the application. For privacy questions or requests, contact{" "}
        <a href="mailto:rugbykritsakorn@gmail.com">rugbykritsakorn@gmail.com</a>
        .
      </p>
      <h2>Information we handle</h2>
      <ul>
        <li>
          <strong>Account information:</strong> sign-in identifiers, name, email
          address and profile information supplied through our authentication
          provider, Clerk, including information you authorize Google to share
          when using Google sign-in. The application database stores your Clerk
          user identifier, display name, account status and language preference.
        </li>
        <li>
          <strong>Organization information:</strong> organization names,
          memberships, roles, warehouse access permissions and administrator
          actions.
        </li>
        <li>
          <strong>Operational information:</strong> warehouse and building
          layouts, storage locations, products, quantities, package dimensions,
          pallet and lot references, scanned codes, movements and other
          information you enter into the application.
        </li>
        <li>
          <strong>Security and activity information:</strong> timestamps, user
          and device identifiers, session references and records of actions and
          access decisions. Our hosting and authentication providers may also
          process technical information such as IP addresses, browser
          information and request logs when delivering and securing the service.
        </li>
        <li>
          <strong>Support information:</strong> information you choose to
          include when contacting us.
        </li>
      </ul>
      <h2>How we use information</h2>
      <p>
        We use information to authenticate users, manage organization access,
        save and display operational records, process warehouse workflows,
        maintain an audit history, provide support, prevent misuse and operate
        and troubleshoot the service. Where applicable law requires a legal
        basis, processing may be necessary to provide the requested service,
        pursue legitimate interests in security and administration, comply with
        legal obligations, or act on consent where required.
      </p>
      <p>
        Google sign-in requests basic identity, email and profile permissions (
        <code>openid</code>, <code>userinfo.email</code> and{" "}
        <code>userinfo.profile</code>). This information is used to establish
        and maintain your account and secure access to the application. Google
        sign-in does not give this application access to your Google password,
        Gmail messages, Drive files or Calendar. The application does not use
        Google account information for advertising or training artificial
        intelligence models.
      </p>
      <h2>Who receives information</h2>
      <p>
        We use <strong>Clerk</strong> for authentication and account management,{" "}
        <strong>Convex</strong> for application data and backend processing, and{" "}
        <strong>Vercel</strong> for hosting and delivery.{" "}
        <strong>Google</strong> processes Google sign-in under its own policies.
        These providers process information needed for their respective
        services.
      </p>
      <p>
        Authorized members and administrators of your organization can access
        information according to their permissions. We may access information to
        provide support and administer the service, and disclose information
        when required by law or reasonably necessary to protect the service and
        its users. We do not sell personal information.
      </p>
      <p>
        Service providers may process information in countries other than your
        own. Applicable privacy protections and available rights can vary by
        location.
      </p>
      <h2>Cookies, browser storage and camera access</h2>
      <p>
        The application and its authentication provider use cookies and browser
        storage for sign-in, security, preferences and saved work drafts. You
        can manage these through your browser; disabling or clearing them may
        sign you out, reset preferences or remove unsaved local work.
      </p>
      <p>
        If you choose barcode scanning, the browser requests camera permission.
        The current scanner processes camera frames on your device; it does not
        upload or store camera video. Decoded codes and resulting warehouse
        actions may be sent to the application backend. You can revoke camera
        permission in your browser settings.
      </p>
      <h2>Retention and deletion</h2>
      <p>
        Account, operational and audit records can remain in the application
        after an account is deactivated. Deleting a sign-in account does not
        automatically erase organization records, historical actions or all
        related application data. Browser drafts may also remain on your device
        until cleared.
      </p>
      <p>
        Contact us to request access, correction, deletion or information about
        retention. We will assess the request with regard to the data involved,
        your organization&apos;s instructions where relevant, security needs,
        legal obligations and other people&apos;s rights. We may need to verify
        your identity. Backup copies and service-provider records may remain
        subject to their retention processes.
      </p>
      <h2>Your choices and rights</h2>
      <p>
        You can manage available account settings, contact your organization
        administrator about access, and remove the application&apos;s Google
        connection in your{" "}
        <a href="https://myaccount.google.com/connections">
          Google Account connections
        </a>
        . Removing that connection does not itself delete records already held
        by the application.
      </p>
      <p>
        Depending on applicable law, you may have rights to access, correct,
        delete or obtain a copy of personal information, restrict or object to
        processing, withdraw consent, or complain to a relevant privacy
        authority. Send requests to{" "}
        <a href="mailto:rugbykritsakorn@gmail.com">rugbykritsakorn@gmail.com</a>
        . Where your organization controls work records, we may direct or
        coordinate the request with its administrator.
      </p>
      <h2>Security and changes</h2>
      <p>
        We use authentication and access controls to help protect information.
        No service can guarantee absolute security. This application is intended
        for authorized business users, rather than children.
      </p>
      <p>
        We may update this policy as the service changes. The date above
        identifies the latest version; material changes will be communicated as
        required by applicable law.
      </p>
    </>
  );
}
