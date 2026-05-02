import { SEO } from "@/components/seo";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { MarketingFooter } from "@/components/marketing/marketing-footer";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--lux-bg)" }}>
      <MarketingNav />
      <SEO title="Privacy Policy" fullTitle="Privacy Policy | CherryWorks Pro" description="How CherryWorks Pro collects, uses, and protects your data. Enterprise-grade security with org-scoped isolation." path="/privacy" />
      <main className="flex-1 pt-[136px] pb-16 px-4">
        <div className="max-w-3xl mx-auto" style={{ color: "var(--lux-text)" }}>
          <h1 className="text-3xl font-bold mb-2" style={{ color: "var(--lux-text)" }}>Privacy Policy</h1>
          <p className="text-sm mb-8" style={{ color: "var(--lux-text-muted)" }}>Last updated: March 29, 2026</p>

          <div className="space-y-6 text-sm leading-relaxed" style={{ color: "var(--lux-text-secondary)" }}>
            <section>
              <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--lux-text)" }}>1. Introduction</h2>
              <p>CherryWorks Pro ("Company," "we," "us," or "our") operates the CherryWorks Pro platform (the "Service"). This Privacy Policy explains how we collect, use, disclose, and protect information when you use our Service. By using the Service, you consent to the practices described in this policy.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--lux-text)" }}>2. Information We Collect</h2>
              <p><strong>Account Information.</strong> When you register, we collect your name, email address, company name, and password (stored in hashed form only — we never store plaintext passwords).</p>
              <p className="mt-2"><strong>Business & Financial Information.</strong> Through your use of the Service, we process information you provide about your business operations, including: client names and contact details; project details; time entries and work descriptions; invoices, payment records, and financial totals; expense records; and team member/employee information (names, email addresses, rates).</p>
              <p className="mt-2"><strong>Team Member Personally Identifiable Information (PII).</strong> If you use the team member onboarding features, you may provide sensitive data about your team members, including: Employer Identification Numbers (EINs), bank account and routing numbers for ACH payments, Zelle contact information, mailing addresses, and W-9 and team member agreement confirmations. This data is stored to facilitate your payout operations and is accessible only within your organization's account.</p>
              <p className="mt-2"><strong>Payment Information.</strong> Subscription payment information (credit card numbers, billing addresses) is collected and processed directly by Stripe, Inc., our payment processor. We do not store your full credit card number on our servers. We receive and store only the last four digits, card brand, and expiration date for your reference.</p>
              <p className="mt-2"><strong>Technical Information.</strong> We automatically collect technical data including IP addresses, browser type and version, device information, operating system, referring URLs, pages visited, access times, and session identifiers. This data is collected through server logs and session cookies.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--lux-text)" }}>3. How We Use Your Information</h2>
              <p>We use collected information to: provide, operate, and maintain the Service; process your transactions and manage your subscription; send transactional notifications (invoice emails, payment confirmations, account alerts); respond to customer support requests; monitor and improve the security, performance, and reliability of the Service; detect and prevent fraud, abuse, and unauthorized access; comply with legal obligations, including tax and financial reporting requirements; and send product updates and feature announcements (which you may opt out of at any time).</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--lux-text)" }}>4. How We Share Your Information</h2>
              <p><strong>We do not sell, rent, or trade your personal information to third parties.</strong></p>
              <p className="mt-2">We share information only in these limited circumstances:</p>
              <p className="mt-2"><strong>Service Providers.</strong> We use trusted third-party providers to operate the Service: Stripe, Inc. (payment processing and subscription billing); Microsoft Corporation (email delivery via Microsoft 365/SMTP); Replit, Inc. (application hosting); and frankfurter.app (currency exchange rate data). Each provider processes only the data necessary to perform their function and is bound by their own privacy policies and contractual obligations.</p>
              <p className="mt-2"><strong>Legal Requirements.</strong> We may disclose information if required by law, subpoena, court order, or government regulation, or if we believe in good faith that disclosure is necessary to protect our rights, your safety, or the safety of others.</p>
              <p className="mt-2"><strong>Business Transfer.</strong> In the event of a merger, acquisition, or sale of assets, your information may be transferred to the acquiring entity. We will provide notice before your information becomes subject to a different privacy policy.</p>
              <p className="mt-2"><strong>With Your Consent.</strong> We may share information with your explicit consent for purposes not covered by this policy.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--lux-text)" }}>5. Data Security</h2>
              <p>We implement industry-standard security measures to protect your data, including: encrypted connections (HTTPS/TLS) for all data in transit; passwords hashed using bcrypt with salt (never stored in plaintext); secure session management with HTTP-only cookies; role-based access controls ensuring team members can only access their own data; tenant isolation ensuring your data is completely separated from other organizations' data; and regular security monitoring and logging of access to sensitive data.</p>
              <p className="mt-2"><strong>Important Notice Regarding Team Member Financial Data.</strong> Sensitive team member information (EIN, bank account numbers, routing numbers) is currently stored in our database. While access is restricted to authorized administrators within your organization, this data is not encrypted at rest beyond standard database-level protections. We recommend that you limit access to this data to only those individuals within your organization who have a legitimate business need. We are actively working to implement field-level encryption for sensitive financial fields in a future update.</p>
              <p className="mt-2">Despite our efforts, no method of electronic storage or transmission is 100% secure. We cannot guarantee absolute security of your data.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--lux-text)" }}>6. Multi-Tenant Data Isolation</h2>
              <p>CherryWorks Pro is a multi-tenant platform. Each organization's data is logically isolated using organization-scoped database queries. Your data — including clients, invoices, time entries, expenses, payments, team members, and reports — is never visible to or accessible by other organizations using the Service. Each user is associated with exactly one organization and can only access data belonging to that organization.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--lux-text)" }}>7. Data Retention</h2>
              <p>We retain your data for as long as your account is active and your subscription is in good standing. After account termination or cancellation, we retain your data for 30 days to allow you to export it or reactivate your account. After 30 days, your data may be permanently and irreversibly deleted from our systems, including all backups. Financial and transaction records may be retained for up to 7 years as required by applicable tax and accounting regulations, even after account deletion.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--lux-text)" }}>8. Your Rights</h2>
              <p>Depending on your jurisdiction, you may have the following rights regarding your personal information:</p>
              <p className="mt-2"><strong>Access & Portability.</strong> You may access and export your data at any time using the built-in export features (CSV downloads, PDF invoices, report exports). For a complete data export, contact us at the email below.</p>
              <p className="mt-2"><strong>Correction.</strong> You may update your personal information through your account settings or by contacting us.</p>
              <p className="mt-2"><strong>Deletion.</strong> You may request deletion of your account and associated data by contacting us. Deletion is subject to the retention periods described in Section 7.</p>
              <p className="mt-2"><strong>Objection & Restriction.</strong> You may object to or request restriction of certain processing activities by contacting us.</p>
              <p className="mt-2">We will respond to all rights requests within 30 days. There is no fee for exercising these rights.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--lux-text)" }}>9. Cookies & Tracking</h2>
              <p>We use only essential cookies required for the Service to function: session cookies for authentication and login state management, and security cookies for CSRF protection. We do not use advertising cookies, tracking pixels, or third-party analytics services. We do not serve ads within the Service and do not track your activity across other websites.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--lux-text)" }}>10. Third-Party Links</h2>
              <p>The Service may contain links to third-party websites, such as Stripe's payment portal or your clients' websites. We are not responsible for the privacy practices of these external sites. We encourage you to review their privacy policies before providing any information.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--lux-text)" }}>11. Children's Privacy</h2>
              <p>The Service is designed for business use and is not directed to individuals under the age of 18. We do not knowingly collect personal information from children. If we become aware that we have inadvertently collected data from a child under 18, we will take steps to delete it promptly.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--lux-text)" }}>12. International Data</h2>
              <p>The Service is hosted in the United States. If you access the Service from outside the United States, your information will be transferred to and processed in the United States. By using the Service, you consent to this transfer. We process data in accordance with applicable U.S. federal and state privacy laws.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--lux-text)" }}>13. Changes to This Policy</h2>
              <p>We may update this Privacy Policy from time to time. Material changes will be communicated via email to the address associated with your account or through a prominent notice within the Service at least 30 days before taking effect. The "Last updated" date at the top indicates the most recent revision. Continued use of the Service after an update constitutes acceptance.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--lux-text)" }}>14. Contact</h2>
              <p>For questions, concerns, or requests regarding this Privacy Policy or your data, contact us at:</p>
              <p className="mt-2">CherryWorks Pro<br />Use the <a href="/contact" style={{ color: "var(--lux-accent)", textDecoration: "underline" }}>contact form</a> to reach us.</p>
            </section>
          </div>
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}
