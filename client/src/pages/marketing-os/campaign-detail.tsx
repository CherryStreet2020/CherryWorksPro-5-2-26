import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { MarketingCampaign } from "@shared/schema";

type Metrics = {
  campaignId: string;
  sentAt: string | null;
  sent: number;
  failed: number;
  permanentFailure: number;
  totalAttempts: number;
  distinctRecipients: number;
};

export default function CampaignDetailPage() {
  const [, params] = useRoute<{ id: string }>("/marketing/campaigns/:id");
  const id = params?.id;

  const { data: campaign, isLoading } = useQuery<MarketingCampaign>({
    queryKey: ["/api/marketing/campaigns", id],
    enabled: !!id,
  });
  const { data: metrics } = useQuery<Metrics>({
    queryKey: ["/api/marketing/campaigns", id, "metrics"],
    enabled: !!id,
  });

  if (!id) return null;
  if (isLoading) {
    return <div className="p-10 text-sm" data-testid="status-loading">Loading…</div>;
  }
  if (!campaign) {
    return (
      <div className="p-10 text-sm" data-testid="empty-state-not-found">
        Campaign not found.
      </div>
    );
  }

  const tiles = [
    { label: "Sent",      value: metrics?.sent ?? 0,             testid: "tile-metric-sent" },
    { label: "Failed",    value: metrics?.failed ?? 0,           testid: "tile-metric-failed" },
    { label: "Permanent", value: metrics?.permanentFailure ?? 0, testid: "tile-metric-permanent" },
    { label: "Recipients", value: metrics?.distinctRecipients ?? 0, testid: "tile-metric-recipients" },
  ];

  return (
    <div className="p-6 max-w-5xl mx-auto" data-testid="page-campaign-detail">
      <Link href="/marketing/campaigns" className="inline-flex items-center text-sm mb-4" data-testid="link-back-campaigns">
        <ArrowLeft className="w-4 h-4 mr-1" />Back to campaigns
      </Link>
      <h1 className="text-2xl font-bold mb-1" data-testid="text-campaign-detail-name">
        {campaign.name}
      </h1>
      <div className="text-sm text-muted-foreground mb-2" data-testid="text-campaign-detail-subject">
        {campaign.subject}
      </div>
      <div className="text-xs mb-4" data-testid="text-campaign-detail-status">
        {campaign.sentAt ? `Sent ${new Date(campaign.sentAt as unknown as string).toISOString()}` : "Not sent"}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6" data-testid="row-campaign-metrics">
        {tiles.map((t) => (
          <Card key={t.testid} className="border" data-testid={t.testid}>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{t.label}</div>
              <div className="text-2xl font-bold" data-testid={`${t.testid}-value`}>{t.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Button asChild variant="outline" data-testid="button-drilldown-failures">
        <Link href={`/marketing/campaigns?failuresFor=${id}`}>View failures</Link>
      </Button>
    </div>
  );
}
