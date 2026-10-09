import { createFileRoute } from "@tanstack/react-router";
import {
  ContactBlock,
  External,
  H3,
  LegalDocument,
  LegalLink,
  List,
  P,
  type LegalSection,
} from "@/components/LegalDocument";

// The Terms of Service. A PUBLIC page (see LegalDocument): it must be readable without an
// account, because people are asked to agree to it before they have one.

const LAST_UPDATED = "October 9, 2026";
const LAST_UPDATED_ISO = "2026-10-09";
const DESCRIPTION =
  "The terms that govern access to and use of Tubify, the revenue management and analytics platform for YouTube creators, businesses and agencies.";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service — Tubify" },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: "Terms of Service — Tubify" },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "article" },
    ],
  }),
  component: Terms,
});

const SECTIONS: LegalSection[] = [
  {
    id: "eligibility-and-accounts",
    title: "Eligibility and Accounts",
    body: (
      <>
        <P>
          You must be at least 18 years old, or the age of legal majority in your jurisdiction, to
          create a Tubify account.
        </P>
        <P>
          You agree to provide accurate account information, maintain the confidentiality of your
          login credentials, and promptly notify us if you suspect unauthorized access.
        </P>
        <P>
          You are responsible for activities performed through your account, except where applicable
          law provides otherwise.
        </P>
        <P>
          If you use Tubify on behalf of a business or organization, you represent that you have
          authority to accept these Terms on its behalf.
        </P>
        <P>We may require additional verification to protect account security.</P>
      </>
    ),
  },
  {
    id: "description-of-the-service",
    title: "Description of the Service",
    body: (
      <>
        <P>
          Tubify helps creators and teams understand, manage, and improve revenue-related activity
          associated with their YouTube channels.
        </P>
        <P>
          Depending on your subscription, permissions, and feature availability, Tubify may provide:
        </P>
        <List
          items={[
            "YouTube channel analytics and revenue reporting.",
            "Video performance insights.",
            "Revenue attribution and tracked links.",
            "Brand deal and campaign management.",
            "Lead collection and management.",
            "Comment automation and engagement tools.",
            "AI-assisted content generation and analysis.",
            "Reports and performance dashboards.",
            "Workspace collaboration and team management.",
            "Other creator monetization and operational tools.",
          ]}
        />
        <P>
          We may introduce, modify, or discontinue features as the Service evolves, subject to
          applicable law and any contractual commitments.
        </P>
        <P>
          Some features require a paid subscription or authorization from a third-party platform.
        </P>
      </>
    ),
  },
  {
    id: "youtube-and-google-integration",
    title: "YouTube and Google Integration",
    body: (
      <>
        <P>
          Tubify uses Google OAuth and YouTube API Services to provide connected YouTube
          functionality.
        </P>
        <P>
          By connecting a YouTube channel, you authorize Tubify to access and process the
          information covered by the permissions you grant.
        </P>
        <P>You retain ownership of your YouTube channel and content.</P>
        <P>
          Your use of YouTube-connected features is also subject to the{" "}
          <External href="https://www.youtube.com/t/terms">YouTube Terms of Service</External>,
          applicable{" "}
          <External href="https://developers.google.com/youtube/terms/api-services-terms-of-service">
            YouTube API Services Terms of Service
          </External>
          , and Google's applicable policies.
        </P>
        <P>
          Tubify is an independent service and is not affiliated with, sponsored by, or endorsed by
          Google or YouTube.
        </P>

        <H3>Authorization and disconnection</H3>
        <P>
          You may revoke Tubify's Google account access through{" "}
          <External href="https://myaccount.google.com/connections">
            Google Account Security
          </External>
          .
        </P>
        <P>
          If authorization expires, is revoked, or becomes invalid, certain Tubify features may stop
          working until you reconnect the affected account.
        </P>
        <P>Tubify cannot guarantee uninterrupted access to third-party APIs.</P>
        <P>
          Disconnecting a YouTube account does not delete the underlying YouTube channel or its
          content.
        </P>
        <P>
          The handling and deletion of information previously retrieved by Tubify is described in
          our <LegalLink to="/privacy">Privacy Policy</LegalLink>.
        </P>
      </>
    ),
  },
  {
    id: "revenue-data-and-analytics",
    title: "Revenue Data and Analytics",
    body: (
      <>
        <P>
          Tubify may display revenue estimates, channel earnings, brand deal values, attribution
          metrics, forecasts, and other financial or performance information.
        </P>
        <P>You acknowledge that:</P>
        <List
          items={[
            "YouTube revenue figures may be estimated, delayed, revised, or subject to adjustments by YouTube.",
            "Revenue data from different sources may have different reporting periods and calculation methods.",
            "Brand deal values, tracked conversions, and pipeline opportunities do not necessarily represent revenue received.",
            "Attribution models may not capture every conversion or revenue event.",
            "Forecasts and recommendations are estimates, not guarantees.",
          ]}
        />
        <P>
          Tubify is intended to support business decisions, not replace official payment records,
          accounting systems, or professional financial advice.
        </P>
        <P>
          You are responsible for verifying financial information before using it for tax,
          accounting, contractual, or investment decisions.
        </P>
        <P>
          Tubify does not guarantee increased views, subscribers, conversions, sponsorships, or
          revenue.
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
          Tubify may offer AI-powered tools for video analysis, descriptions, content ideas,
          recommendations, and other creator workflows.
        </P>
        <P>
          AI-generated content may contain inaccuracies, omissions, or unsuitable recommendations.
        </P>
        <P>
          You are responsible for reviewing and approving AI-generated content before publishing or
          relying on it.
        </P>
        <P>
          You must not use AI features to generate unlawful, misleading, infringing, abusive, or
          otherwise prohibited content.
        </P>
        <P>
          The availability, usage limits, and functionality of AI features may vary by subscription
          plan.
        </P>
        <P>
          AI outputs are not guaranteed to be unique or protected by intellectual property rights.
        </P>
      </>
    ),
  },
  {
    id: "your-content-and-data",
    title: "Your Content and Data",
    body: (
      <>
        <P>
          You retain ownership of content and business information that you submit to Tubify,
          subject to any rights held by third parties.
        </P>
        <P>
          You grant Tubify a limited, non-exclusive permission to host, process, display, and
          otherwise use your submitted content as necessary to provide the Service, maintain
          security, and perform the functions you request.
        </P>
        <P>
          You represent that you have the necessary rights and permissions to upload, share, or
          process any content or personal information through Tubify.
        </P>
        <P>
          You must not upload information obtained unlawfully or use Tubify to violate another
          person's privacy or intellectual property rights.
        </P>
        <P>
          Tubify's processing of personal information is described in its{" "}
          <LegalLink to="/privacy">Privacy Policy</LegalLink>.
        </P>
      </>
    ),
  },
  {
    id: "workspaces-and-team-members",
    title: "Workspaces and Team Members",
    body: (
      <>
        <P>Tubify may allow authorized users to invite collaborators into a workspace.</P>
        <P>
          Workspace owners and authorized administrators are responsible for managing invitations,
          assigned roles, and access to workspace information.
        </P>
        <P>Team members must comply with these Terms and the permissions assigned to them.</P>
        <P>Workspace access may be limited by subscription plan and role-based permissions.</P>
        <P>
          A workspace owner is responsible for ensuring that invited users have appropriate
          authorization to access shared information.
        </P>
      </>
    ),
  },
  {
    id: "acceptable-use",
    title: "Acceptable Use",
    body: (
      <>
        <P>You agree not to:</P>
        <List
          items={[
            "Use Tubify for illegal, fraudulent, or deceptive activities.",
            "Access accounts, channels, or information without authorization.",
            "Attempt to bypass subscription limits or access controls.",
            "Interfere with the security or operation of the Service.",
            "Distribute malware or malicious code.",
            "Use automated methods to overload or abuse the Service.",
            "Infringe intellectual property or privacy rights.",
            "Send unlawful spam or unauthorized promotional messages.",
            "Use comment automation or engagement tools in violation of YouTube's policies.",
            "Manipulate engagement metrics or participate in prohibited artificial engagement practices.",
            "Resell, sublicense, or exploit the Service without authorization.",
          ]}
        />
        <P>
          We may investigate suspected violations and restrict access where reasonably necessary to
          protect users, the Service, or third parties.
        </P>
      </>
    ),
  },
  {
    id: "subscriptions-and-billing",
    title: "Subscriptions and Billing",
    body: (
      <>
        <P>Tubify may offer free, trial, and paid subscription plans.</P>
        <P>
          Plan features, usage limits, billing intervals, and prices are displayed during
          subscription selection or checkout.
        </P>
        <P>
          Paid subscriptions may be processed through Stripe or another authorized payment provider.
        </P>
        <P>
          By purchasing a subscription, you authorize the applicable recurring charges disclosed at
          checkout.
        </P>
        <P>
          Unless otherwise stated during purchase, subscriptions renew automatically until canceled.
        </P>
        <P>
          You may cancel renewal through the available billing controls or by contacting support.
        </P>
        <P>
          Cancellation generally prevents future renewals; access to paid features may continue
          until the end of the current paid billing period, unless otherwise required by law or the
          applicable purchase terms.
        </P>
        <P>
          Refund eligibility is governed by the refund terms disclosed at purchase and applicable
          consumer protection laws.
        </P>
        <P>
          We will provide notice of material pricing or subscription changes where required by law.
        </P>
      </>
    ),
  },
  {
    id: "service-availability-and-changes",
    title: "Service Availability and Changes",
    body: (
      <>
        <P>
          We aim to provide a reliable Service but do not guarantee uninterrupted or error-free
          operation.
        </P>
        <P>
          Availability may be affected by maintenance, infrastructure failures, third-party outages,
          API restrictions, or circumstances outside our reasonable control.
        </P>
        <P>
          Some features depend on external services, including Google, YouTube, payment processors,
          and AI providers.
        </P>
        <P>
          We may update the Service to improve functionality, security, compliance, or performance.
        </P>
        <P>
          Where changes materially affect paid services, we will provide any notice or remedies
          required by applicable law.
        </P>
      </>
    ),
  },
  {
    id: "intellectual-property",
    title: "Intellectual Property",
    body: (
      <>
        <P>
          Tubify and its licensors retain ownership of the Service, including its software,
          interface designs, branding, documentation, and other proprietary materials.
        </P>
        <P>
          These Terms grant you a limited, non-exclusive, non-transferable right to access and use
          the Service in accordance with your subscription and these Terms.
        </P>
        <P>They do not transfer ownership of Tubify's intellectual property.</P>
        <P>
          You may not copy, distribute, reverse engineer, or commercially exploit protected portions
          of the Service except where expressly permitted by law or written authorization.
        </P>
      </>
    ),
  },
  {
    id: "third-party-services",
    title: "Third-Party Services",
    body: (
      <>
        <P>Tubify integrates with services operated by third parties.</P>
        <P>
          Your use of those services may be governed by their own terms, privacy policies, and
          technical limitations.
        </P>
        <P>
          Tubify does not control third-party services and is not responsible for their independent
          policies or actions, except to the extent required by applicable law.
        </P>
        <P>Changes to third-party APIs may affect the availability of connected features.</P>
      </>
    ),
  },
  {
    id: "suspension-and-termination",
    title: "Suspension and Termination",
    body: (
      <>
        <P>
          You may stop using Tubify and request account deletion in accordance with our{" "}
          <LegalLink to="/privacy">Privacy Policy</LegalLink>.
        </P>
        <P>We may suspend or terminate access where reasonably necessary because of:</P>
        <List
          items={[
            "Serious violations of these Terms.",
            "Fraudulent or unlawful activity.",
            "Security threats or unauthorized access.",
            "Failure to pay applicable subscription fees.",
            "Legal or regulatory requirements.",
          ]}
        />
        <P>
          Where appropriate and legally permitted, we will provide notice and an opportunity to
          resolve the issue.
        </P>
        <P>
          Upon termination, access to the Service may end. Information will be retained or deleted
          according to our <LegalLink to="/privacy">Privacy Policy</LegalLink> and applicable law.
        </P>
        <P>
          Termination does not eliminate payment obligations or legal rights that arose before
          termination.
        </P>
      </>
    ),
  },
  {
    id: "disclaimers",
    title: "Disclaimers",
    body: (
      <>
        <P>
          To the extent permitted by applicable law, Tubify is provided on an &ldquo;as
          available&rdquo; and &ldquo;as is&rdquo; basis.
        </P>
        <P>
          We do not guarantee that the Service will be uninterrupted, that all analytics will be
          accurate or complete, or that using Tubify will produce particular business or financial
          outcomes.
        </P>
        <P>
          Nothing in these Terms excludes warranties or consumer rights that cannot lawfully be
          excluded.
        </P>
      </>
    ),
  },
  {
    id: "limitation-of-liability",
    title: "Limitation of Liability",
    body: (
      <>
        <P>
          To the extent permitted by applicable law, Tubify and its operators will not be liable for
          indirect, incidental, special, or consequential losses arising from use of the Service,
          including lost profits, business opportunities, or data, where such exclusions are legally
          permitted.
        </P>
        <P>
          Nothing in these Terms excludes or limits liability that cannot legally be excluded or
          limited, including liability for fraud, intentional misconduct, or other non-excludable
          obligations.
        </P>
        <P>
          Any additional liability cap should be specified in the final legally reviewed version of
          these Terms.
        </P>
      </>
    ),
  },
  {
    id: "privacy-and-data-protection",
    title: "Privacy and Data Protection",
    body: (
      <>
        <P>
          Our collection, processing, storage, and deletion of personal information is described in
          our <LegalLink to="/privacy">Privacy Policy</LegalLink>.
        </P>
        <P>
          By using Tubify, you acknowledge that personal information will be handled according to
          that policy and applicable data protection requirements.
        </P>
        <P>
          You may contact us to exercise applicable privacy rights or request account and data
          deletion.
        </P>
      </>
    ),
  },
  {
    id: "changes-to-these-terms",
    title: "Changes to These Terms",
    body: (
      <>
        <P>
          We may update these Terms to reflect changes in the Service, legal requirements, or
          business operations.
        </P>
        <P>
          When changes materially affect your rights, we will provide notice as required by
          applicable law.
        </P>
        <P>The date at the beginning of these Terms identifies the most recent update.</P>
        <P>
          Continued use after changes take effect may constitute acceptance where permitted by
          applicable law.
        </P>
      </>
    ),
  },
  {
    id: "governing-law-and-disputes",
    title: "Governing Law and Disputes",
    body: (
      <>
        <P>
          These Terms will be governed by the laws of the jurisdiction in which Tubify's operating
          legal entity is established, subject to any mandatory consumer protection laws that apply
          to you.
        </P>
        <P>
          Before initiating formal legal proceedings, you may contact us to attempt to resolve a
          dispute informally.
        </P>
        <P>
          The applicable governing-law jurisdiction and dispute-resolution venue should be specified
          in the final legally reviewed version of these Terms.
        </P>
      </>
    ),
  },
  {
    id: "contact-information",
    title: "Contact Information",
    body: (
      <>
        <P>
          For questions about these Terms, subscriptions, account access, or the Service, contact:
        </P>
        <ContactBlock />
      </>
    ),
  },
];

function Terms() {
  return (
    <LegalDocument
      path="/terms"
      title="Terms of Service"
      lastUpdated={LAST_UPDATED}
      lastUpdatedIso={LAST_UPDATED_ISO}
      intro={
        <>
          <p>Welcome to Tubify.</p>
          <p>
            These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of Tubify's
            website, applications, software, and related services (collectively, the
            &ldquo;Service&rdquo;).
          </p>
          <p>
            Tubify provides a revenue management and analytics platform designed for YouTube
            creators, businesses, and agencies.
          </p>
          <p>
            By creating an account, accessing, or using Tubify, you agree to these Terms and our{" "}
            <LegalLink to="/privacy">Privacy Policy</LegalLink>.
          </p>
          <p>If you do not agree to these Terms, you must not use the Service.</p>
        </>
      }
      sections={SECTIONS}
      closing={
        <strong className="font-semibold text-foreground">
          Tubify is an independent platform and is not affiliated with, sponsored by, or endorsed by
          Google or YouTube.
        </strong>
      }
    />
  );
}
