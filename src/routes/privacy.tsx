import { createFileRoute } from "@tanstack/react-router";
import {
  ContactBlock,
  Email,
  External,
  H3,
  LegalDocument,
  List,
  P,
  type LegalSection,
} from "@/components/LegalDocument";

// The Privacy Policy. A PUBLIC page (see LegalDocument): it must be readable without an account —
// visitors arrive from the landing page's footer, and Google's OAuth and YouTube API reviews
// open it signed out.

const LAST_UPDATED = "October 9, 2026";
const LAST_UPDATED_ISO = "2026-10-09";
const PRIVACY_EMAIL = "hey@tubify.app";
const DESCRIPTION =
  "How Tubify collects, uses, stores, shares and protects personal information, including data obtained through Google and YouTube API Services.";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — Tubify" },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: "Privacy Policy — Tubify" },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "article" },
    ],
  }),
  component: Privacy,
});

// `sharing` and `security` are linked from Settings; keep those ids.
const SECTIONS: LegalSection[] = [
  {
    id: "information-we-collect",
    title: "Information We Collect",
    body: (
      <>
        <H3>Account information</H3>
        <P>
          When you register or use Tubify, we may collect your name, email address, profile image,
          account identifier, workspace membership, and authentication information.
        </P>
        <P>
          If you sign in through Google, we receive information authorized through the Google
          authentication process. We do not receive or store your Google account password.
        </P>

        <H3>YouTube channel information</H3>
        <P>
          When you explicitly authorize Tubify to access your YouTube account, we may retrieve and
          process information made available through the permissions you grant, including:
        </P>
        <List
          items={[
            "YouTube channel identifiers, names, and metadata.",
            "Video titles, descriptions, identifiers, thumbnails, and other video metadata.",
            "Video and channel analytics, including views, watch time, and subscriber metrics.",
            "YouTube Analytics revenue estimates and monetization performance data, where available and authorized.",
            "Video captions or transcripts, where available through authorized functionality.",
            "Other channel information necessary to provide the YouTube features you choose to use.",
          ]}
        />
        <P>
          The information available to Tubify depends on Google's authorization permissions, API
          availability, and your account's access rights.
        </P>

        <H3>Business and workspace information</H3>
        <P>
          We may collect information you enter into Tubify, including tracked links, campaign
          information, brand deals, lead records, project details, team memberships, and other
          workspace content.
        </P>

        <H3>Usage and technical information</H3>
        <P>
          We may process information such as browser type, device information, IP address,
          application activity, authentication events, error logs, and feature usage to operate,
          secure, troubleshoot, and improve Tubify.
        </P>

        <H3>Billing information</H3>
        <P>
          If you purchase a subscription, our payment processor may collect and process payment
          information. Tubify may retain billing identifiers, subscription status, transaction
          references, and related records needed to administer your subscription.
        </P>
        <P>We do not intentionally store complete payment-card numbers.</P>
      </>
    ),
  },
  {
    id: "how-we-use-information",
    title: "How We Use Information",
    body: (
      <>
        <P>We use information to:</P>
        <List
          items={[
            "Create, authenticate, and manage accounts and workspaces.",
            "Connect authorized YouTube channels.",
            "Display channel performance, analytics, and revenue information.",
            "Attribute and organize revenue-related activity across videos, campaigns, and tracked links.",
            "Provide creator tools, reports, and AI-assisted features.",
            "Support team collaboration and workspace permissions.",
            "Process subscriptions and account-related communications.",
            "Maintain application security and prevent misuse.",
            "Troubleshoot errors and improve the reliability of our services.",
            "Comply with applicable legal obligations.",
          ]}
        />
        <P>We do not sell personal information or Google user data.</P>
      </>
    ),
  },
  {
    id: "google-and-youtube-api-services",
    title: "Google and YouTube API Services",
    body: (
      <>
        <P>
          Tubify uses YouTube API Services, including the YouTube Data API and YouTube Analytics
          API.
        </P>
        <P>
          By using Tubify's YouTube-connected features, you also agree to be bound by the{" "}
          <External href="https://www.youtube.com/t/terms">YouTube Terms of Service</External>.
        </P>
        <P>
          Google's handling of your information is governed by the{" "}
          <External href="https://policies.google.com/privacy">Google Privacy Policy</External>.
        </P>

        <H3>Authorization and access</H3>
        <P>
          Tubify accesses YouTube account information only after you authorize the requested
          permissions through Google's OAuth consent process.
        </P>
        <P>
          Depending on the features being used, those permissions may allow Tubify to access channel
          information, analytics, monetization information, and other authorized YouTube data.
        </P>
        <P>Tubify does not request or store your Google password.</P>
        <P>
          To maintain a connection, Tubify securely processes Google authorization tokens. These
          tokens are used to make authorized API requests and maintain access until authorization
          expires or is revoked.
        </P>

        <H3>How Google user data is used</H3>
        <P>
          Information obtained through Google APIs is used to provide and improve the user-facing
          features you authorize, such as YouTube analytics, revenue reporting, video insights, and
          connected creator workflows.
        </P>
        <P>
          Tubify's use and transfer of information received from Google APIs adheres to the{" "}
          <External href="https://developers.google.com/terms/api-services-user-data-policy">
            Google API Services User Data Policy
          </External>
          , including its Limited Use requirements.
        </P>
        <P>
          We do not sell Google user data, transfer it to data brokers, or use it to serve
          personalized advertisements or retarget users.
        </P>

        <H3>Sharing Google user data</H3>
        <P>
          Authorized Google and YouTube data may be processed by service providers only where
          necessary to deliver the features you request, operate the service securely, or comply
          with applicable law, subject to Google's applicable data-use restrictions.
        </P>
        <P>
          Workspace members may access authorized information only according to their permissions
          and the access granted by the account or workspace owner.
        </P>

        <H3>Revoking YouTube access</H3>
        <P>
          You can revoke Tubify's access to your Google account at any time through{" "}
          <External href="https://myaccount.google.com/connections">
            Google Account Security — Third-party connections
          </External>
          .
        </P>
        <P>
          You may also request disconnection and deletion of associated information by contacting us
          at <Email address={PRIVACY_EMAIL} />.
        </P>
        <P>
          Revoking Google authorization prevents future authorized access, but does not itself
          guarantee that information already stored by Tubify has been deleted. We handle stored
          data according to the deletion procedures and applicable YouTube API Services requirements
          described below.
        </P>
      </>
    ),
  },
  {
    id: "ai-assisted-features",
    title: "AI-Assisted Features",
    body: (
      <>
        <P>
          Tubify may provide AI-assisted functionality, including content analysis, description
          generation, and performance insights.
        </P>
        <P>
          When you request an AI-powered feature, relevant information may be processed by an AI
          service provider to generate the requested output.
        </P>
        <P>
          Depending on the feature, this may include video titles, descriptions, transcripts,
          performance information, or content you provide.
        </P>
        <P>
          We do not intentionally send Google OAuth credentials, payment-card details, or unrelated
          workspace records to AI providers.
        </P>
        <P>
          Where Google user data is involved, its processing and transfer are subject to Google's
          applicable Limited Use requirements.
        </P>
        <P>AI-generated results may be inaccurate and should be reviewed before use.</P>
      </>
    ),
  },
  {
    id: "sharing",
    title: "Service Providers and Data Sharing",
    body: (
      <>
        <P>
          We may share information with service providers that help us operate Tubify, including
          providers of:
        </P>
        <List
          items={[
            "Application hosting and infrastructure.",
            "Database hosting, storage, and authentication.",
            "Payment processing.",
            "Transactional email.",
            "AI processing.",
            "Security, monitoring, and technical support.",
          ]}
        />
        <P>
          These providers process information as necessary for their services, subject to applicable
          agreements, safeguards, and legal requirements.
        </P>
        <P>
          We may also disclose information where required by law or where reasonably necessary to
          protect the security and rights of Tubify and its users.
        </P>
        <P>We do not sell personal information.</P>
      </>
    ),
  },
  {
    id: "cookies-and-local-storage",
    title: "Cookies and Local Storage",
    body: (
      <>
        <P>
          Tubify uses cookies and browser storage to support authentication, security, session
          management, and application preferences.
        </P>
        <P>
          For example, browser storage may remember your theme, navigation preferences, or
          onboarding progress.
        </P>
        <P>
          We may also use analytics or similar technologies to understand product usage, where
          implemented and permitted by applicable law.
        </P>
        <P>
          You can manage browser storage through your browser settings. Removing essential cookies
          or stored information may sign you out or reset application preferences.
        </P>
        <P>
          Where consent is legally required for non-essential tracking technologies, we will request
          it before using them.
        </P>
      </>
    ),
  },
  {
    id: "security",
    title: "Data Security",
    body: (
      <>
        <P>
          We use technical and organizational safeguards designed to protect information against
          unauthorized access, alteration, disclosure, and loss.
        </P>
        <P>
          These measures may include encrypted communications, protected credential storage, access
          controls, and security monitoring.
        </P>
        <P>
          Google authorization credentials are handled separately from ordinary user-facing account
          information and are not intentionally exposed to other workspace members.
        </P>
        <P>No online service can guarantee absolute security.</P>
      </>
    ),
  },
  {
    id: "data-storage-and-international-processing",
    title: "Data Storage and International Processing",
    body: (
      <>
        <P>
          Tubify uses third-party infrastructure and service providers to host and process
          application data.
        </P>
        <P>
          Depending on the services involved, information may be processed in different countries,
          including countries outside your country of residence.
        </P>
        <P>
          Where required, we use appropriate contractual and organizational safeguards for
          international transfers.
        </P>
        <P>
          We will update this policy as our hosting infrastructure and processing arrangements
          change.
        </P>
      </>
    ),
  },
  {
    id: "data-retention",
    title: "Data Retention",
    body: (
      <>
        <P>
          We retain personal information only for as long as reasonably necessary to provide Tubify,
          fulfill the purposes described in this policy, meet applicable legal requirements, and
          resolve legitimate disputes.
        </P>
        <P>Different categories of information may have different retention periods.</P>
        <P>
          YouTube API data is subject to additional storage, refresh, authorization-validation, and
          deletion requirements under the YouTube API Services policies.
        </P>
        <P>
          Where those policies require deletion or refresh of particular information within a
          specified period, we will follow the applicable requirement.
        </P>
        <P>
          Account, billing, and security records may be retained for different periods where
          required or permitted by law.
        </P>
        <P>
          Backup copies may remain temporarily within controlled retention cycles, subject to
          applicable deletion obligations.
        </P>
      </>
    ),
  },
  {
    id: "disconnecting-youtube-and-deleting-data",
    title: "Disconnecting YouTube and Deleting Data",
    body: (
      <>
        <P>
          You may request that Tubify stop accessing your YouTube account and delete associated
          information.
        </P>
        <P>
          You can revoke authorization through your Google account's third-party connection settings
          or contact <Email address={PRIVACY_EMAIL} /> for assistance.
        </P>
        <P>
          For deletion requests involving YouTube API data, we will process the request as soon as
          possible and within the applicable deadlines required by the YouTube API Services
          policies, including the seven-calendar-day requirement where applicable.
        </P>
        <P>
          Disconnecting Tubify or deleting information stored by Tubify does not delete your
          original videos, channel, or other information held by YouTube.
        </P>
        <P>
          To delete content from YouTube itself, you must use YouTube or another authorized method
          supported by YouTube.
        </P>
        <P>
          You may also request deletion of your Tubify account and associated personal information
          through available account settings or by contacting us.
        </P>
        <P>
          Some records may need to be retained where legally required, provided such retention is
          permitted under the applicable Google and YouTube policies.
        </P>
      </>
    ),
  },
  {
    id: "your-privacy-rights",
    title: "Your Privacy Rights",
    body: (
      <>
        <P>Depending on your location and applicable law, you may have the right to:</P>
        <List
          items={[
            "Access personal information we hold about you.",
            "Request correction of inaccurate information.",
            "Request deletion of personal information.",
            "Request a portable copy of eligible information.",
            "Object to or restrict certain processing.",
            "Withdraw consent where processing is based on consent.",
            "Submit a complaint to an appropriate data protection authority.",
          ]}
        />
        <P>
          To exercise these rights, use the relevant controls available in your Tubify account or
          contact <Email address={PRIVACY_EMAIL} />.
        </P>
        <P>We may need to verify your identity before fulfilling certain requests.</P>
      </>
    ),
  },
  {
    id: "childrens-privacy",
    title: "Children's Privacy",
    body: (
      <>
        <P>
          Tubify is intended for professional creators, businesses, and teams, and is not directed
          to children under 13.
        </P>
        <P>
          We do not knowingly collect personal information from children under 13. If we learn that
          such information has been collected inappropriately, we will take steps to address it in
          accordance with applicable law.
        </P>
      </>
    ),
  },
  {
    id: "changes-to-this-policy",
    title: "Changes to This Policy",
    body: (
      <>
        <P>
          We may update this Privacy Policy to reflect changes in our services, technology, legal
          requirements, or data practices.
        </P>
        <P>When changes are material, we will provide notice as required by applicable law.</P>
        <P>The date at the top of this page indicates when the policy was last updated.</P>
      </>
    ),
  },
  {
    id: "contact-us",
    title: "Contact Us",
    body: (
      <>
        <P>
          For questions, privacy requests, YouTube data deletion, or concerns about this Privacy
          Policy, contact:
        </P>
        <ContactBlock />
      </>
    ),
  },
];

function Privacy() {
  return (
    <LegalDocument
      path="/privacy"
      title="Privacy Policy"
      lastUpdated={LAST_UPDATED}
      lastUpdatedIso={LAST_UPDATED_ISO}
      intro={
        <>
          <p>
            Tubify (&ldquo;Tubify,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;)
            provides a revenue management and analytics platform for YouTube creators, teams, and
            agencies.
          </p>
          <p>
            This Privacy Policy explains how we collect, use, store, disclose, and protect personal
            information when you visit our website, use our services, or connect your YouTube
            channel.
          </p>
          <p>
            It also explains your choices regarding information obtained through Google and YouTube
            API Services.
          </p>
          <p>
            By using Tubify, you acknowledge this Privacy Policy. Where consent is required, we will
            request it separately.
          </p>
        </>
      }
      sections={SECTIONS}
      closing="Tubify is an independent service and is not affiliated with or endorsed by Google or YouTube."
    />
  );
}
