import { SEO } from "@/components/seo";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { MarketingFooter } from "@/components/marketing/marketing-footer";

export default function TermsPage() {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--lux-bg)" }}>
      <MarketingNav />
      <SEO title="Terms of Service" fullTitle="Terms of Service | CherryWorks Pro" description="Terms governing your use of CherryWorks Pro platform and services." path="/terms" />
      <main className="flex-1 pt-[136px] pb-16 px-4">
        <div className="max-w-3xl mx-auto" style={{ color: "var(--lux-text)" }}>
          <h1 className="text-3xl font-bold mb-2" style={{ color: "var(--lux-text)" }}>Terms of Service</h1>
          <p className="text-sm mb-8" style={{ color: "var(--lux-text-muted)" }}>Last updated: March 29, 2026</p>

          <div className="space-y-6 text-sm leading-relaxed" style={{ color: "var(--lux-text-secondary)" }}>
            <section>
              <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--lux-text)" }}>1. Agreement to Terms</h2>
              <p>These Terms of Service ("Terms") constitute a legally binding agreement between you ("Subscriber," "you," or "your") and CherryWorks Pro ("Company," "we," "us," or "our"), governing your access to and use of the CherryWorks Pro platform, including all related software, websites, APIs, and documentation (collectively, the "Service").</p>
              <p className="mt-2">By creating an account, accessing, or using the Service, you acknowledge that you have read, understood, and agree to be bound by these Terms. If you are entering into these Terms on behalf of a company or other legal entity, you represent that you have the authority to bind that entity. If you do not agree to these Terms, do not use the Service.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--lux-text)" }}>2. Description of Service</h2>
              <p>CherryWorks Pro is a cloud-based professional services management platform designed for consulting firms, agencies, and businesses managing blended workforces (1099 independents, W-2 employees, and Corp-to-Corp engagements). The Service provides time tracking, invoicing, expense management, payout tracking, financial reporting, client portals, and related operational tools. Features and functionality may vary by subscription tier.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--lux-text)" }}>3. Account Registration & Eligibility</h2>
              <p>You must be at least 18 years old and capable of forming a binding contract to use the Service. When registering, you agree to provide accurate, current, and complete information. You are solely responsible for maintaining the confidentiality of your login credentials and for all activities that occur under your account. You must notify us immediately via the <a href="/contact" style={{ color: "var(--lux-accent)", textDecoration: "underline" }}>contact form</a> upon discovering any unauthorized use of your account.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--lux-text)" }}>4. Subscription Plans, Billing & Trials</h2>
              <p><strong>Subscription.</strong> The Service is offered on a subscription basis at the pricing published on our website. Plans are differentiated by the number of active clients permitted and available features. All plans include unlimited user seats.</p>
              <p className="mt-2"><strong>Free Trial.</strong> New accounts receive a 14-day free trial with full access to the selected plan's features. A valid payment method is required at signup but will not be charged during the trial period. If you do not cancel before the trial ends, your subscription will automatically begin and your payment method will be charged.</p>
              <p className="mt-2"><strong>Billing.</strong> Paid subscriptions are billed in advance on a monthly or annual cycle, depending on your selection. After your trial period, the remaining days of the first month are billed pro-rata, followed by regular monthly or annual billing. All fees are non-refundable except as expressly stated in these Terms or required by applicable law.</p>
              <p className="mt-2"><strong>Price Changes.</strong> We reserve the right to modify pricing at any time. Existing subscribers will receive at least 30 days' advance notice before any price increase takes effect on their account. You may cancel your subscription before the price change takes effect.</p>
              <p className="mt-2"><strong>Taxes.</strong> All prices are exclusive of applicable taxes. You are responsible for any sales tax, VAT, or similar taxes imposed by applicable jurisdictions, which will be added to your invoice as required.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--lux-text)" }}>5. One Subscription Per Legal Entity</h2>
              <p>Each subscription to CherryWorks Pro is licensed for use by a single legal entity (company, LLC, sole proprietorship, or equivalent). You may not use a single subscription to manage the operations, finances, or workforce of multiple distinct legal entities. If you operate multiple legal entities, each entity requires its own separate subscription. We reserve the right to audit usage and suspend or terminate accounts that violate this provision.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--lux-text)" }}>6. Trial Abuse & Fair Use</h2>
              <p>Free trials are limited to one per legal entity. Creating multiple accounts using different email addresses or payment methods to obtain additional free trials is a violation of these Terms. We employ automated systems to detect trial abuse, including but not limited to email domain tracking and payment method fingerprinting. We reserve the right to immediately terminate accounts created in violation of this policy without notice and to charge the applicable subscription fee for any period of unauthorized trial use.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--lux-text)" }}>7. Acceptable Use</h2>
              <p>You agree to use the Service only for its intended purpose of managing professional services operations. You may not: (a) use the Service for any unlawful purpose; (b) upload malicious code, viruses, or harmful content; (c) attempt to gain unauthorized access to our systems or other users' accounts; (d) interfere with the Service's operation, security, or performance; (e) resell, sublicense, or redistribute the Service without our written consent; (f) use the Service to store or transmit content that infringes third-party intellectual property rights. We may suspend or terminate accounts that violate these terms without notice.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--lux-text)" }}>8. Data Ownership & Portability</h2>
              <p>You retain all ownership rights to the data you upload, create, or generate through the Service ("Your Data"). We do not claim ownership of Your Data. We use Your Data solely to provide, maintain, and improve the Service as described in our Privacy Policy. You may export Your Data at any time using the export features available within the Service (including CSV exports of reports, invoices, time entries, and other records).</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--lux-text)" }}>9. Intellectual Property</h2>
              <p>The Service, including all software, designs, text, graphics, interfaces, and documentation, is owned by CherryWorks Pro and protected by intellectual property laws. Your subscription grants you a limited, non-exclusive, non-transferable, revocable license to access and use the Service for your internal business operations during the subscription term. All rights not expressly granted are reserved.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--lux-text)" }}>10. Service Availability & Modifications</h2>
              <p>We strive to maintain high availability but do not guarantee uninterrupted access. The Service may be temporarily unavailable for maintenance, updates, or circumstances beyond our control. We reserve the right to modify, update, or discontinue features of the Service at any time. Material feature removals affecting paid functionality will be communicated with reasonable advance notice.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--lux-text)" }}>11. Disclaimer of Warranties</h2>
              <p>THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT, OR ACCURACY. WE DO NOT WARRANT THAT THE SERVICE WILL BE ERROR-FREE, UNINTERRUPTED, OR SECURE. THE SERVICE IS NOT INTENDED TO PROVIDE LEGAL, TAX, OR ACCOUNTING ADVICE. YOU ARE SOLELY RESPONSIBLE FOR ENSURING YOUR USE OF THE SERVICE COMPLIES WITH APPLICABLE LAWS AND PROFESSIONAL STANDARDS.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--lux-text)" }}>12. Limitation of Liability</h2>
              <p>TO THE MAXIMUM EXTENT PERMITTED BY LAW, CHERRY STREET CONSULTING LLC SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO LOSS OF PROFITS, DATA, BUSINESS OPPORTUNITIES, OR GOODWILL, ARISING FROM OR RELATED TO YOUR USE OF THE SERVICE, REGARDLESS OF THE THEORY OF LIABILITY. OUR TOTAL AGGREGATE LIABILITY FOR ALL CLAIMS ARISING UNDER OR RELATED TO THESE TERMS SHALL NOT EXCEED THE AMOUNTS PAID BY YOU TO US IN THE TWELVE (12) MONTHS IMMEDIATELY PRECEDING THE EVENT GIVING RISE TO THE CLAIM.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--lux-text)" }}>13. Indemnification</h2>
              <p>You agree to indemnify, defend, and hold harmless CherryWorks Pro, its officers, directors, employees, and agents from any claims, damages, losses, liabilities, costs, and expenses (including reasonable attorneys' fees) arising from: (a) your use of the Service; (b) your violation of these Terms; (c) your violation of any applicable law or regulation; or (d) your infringement of any third-party rights.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--lux-text)" }}>14. Termination</h2>
              <p><strong>By You.</strong> You may cancel your subscription at any time through the Service or by contacting us. Cancellation takes effect at the end of your current billing period. You will retain access until then.</p>
              <p className="mt-2"><strong>By Us.</strong> We may suspend or terminate your account immediately if you violate these Terms, engage in fraudulent activity, or fail to pay applicable fees. We may also terminate your account with 30 days' notice for any reason.</p>
              <p className="mt-2"><strong>Effect of Termination.</strong> Upon termination, your right to access the Service ceases. We will retain Your Data for 30 days following termination to allow you to export it. After 30 days, Your Data may be permanently deleted. Provisions that by their nature should survive termination (including Sections 8, 11, 12, 13, and 16) will survive.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--lux-text)" }}>15. Changes to Terms</h2>
              <p>We may update these Terms at any time. Material changes will be communicated via email to the address associated with your account or through a prominent notice within the Service at least 30 days before taking effect. Your continued use of the Service after the effective date constitutes acceptance of the updated Terms. If you do not agree to the updated Terms, you must discontinue use and cancel your subscription.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--lux-text)" }}>16. Governing Law & Dispute Resolution</h2>
              <p>These Terms are governed by and construed in accordance with the laws of the State of Delaware, without regard to its conflict of law principles. Any dispute arising from or relating to these Terms or the Service shall be resolved exclusively in the state or federal courts located in Delaware. You consent to the personal jurisdiction of such courts. Before filing any legal action, both parties agree to attempt good-faith resolution through direct communication for a period of at least 30 days.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--lux-text)" }}>17. Miscellaneous</h2>
              <p><strong>Entire Agreement.</strong> These Terms, together with the Privacy Policy, constitute the entire agreement between you and CherryWorks Pro regarding the Service. <strong>Severability.</strong> If any provision is found unenforceable, the remaining provisions remain in full force. <strong>Waiver.</strong> Our failure to enforce any provision is not a waiver of our right to enforce it later. <strong>Assignment.</strong> You may not assign your rights under these Terms without our prior written consent. We may assign our rights without restriction.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--lux-text)" }}>18. Contact</h2>
              <p>CherryWorks Pro<br />Use the <a href="/contact" style={{ color: "var(--lux-accent)", textDecoration: "underline" }}>contact form</a> to reach us.</p>
            </section>
          </div>
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}
