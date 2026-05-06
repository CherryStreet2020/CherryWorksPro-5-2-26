import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Cherry, ArrowRight, ArrowLeft, Check,
  User, Building2, CreditCard, MapPin, Rocket,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getProjectColor } from "@/components/time/utils";
import { useDocumentTitle } from "@/lib/use-document-title";
import { Redirect } from "wouter";

interface ProjectOption {
  id: string;
  name: string;
  clientName: string;
}

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC",
];

function formatEin(val: string): string {
  const digits = val.replace(/\D/g, "").slice(0, 9);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

function formatRoutingNumber(val: string): string {
  return val.replace(/\D/g, "").slice(0, 9);
}

type StepId = "profile" | "business" | "payment" | "address" | "review";

export default function OnboardingPage() {
  useDocumentTitle("Onboarding");
  const { toast } = useToast();
  const { user } = useAuth();

  const [stepIndex, setStepIndex] = useState(0);
  const [loading, setLoading] = useState(false);

  const [editFirstName, setEditFirstName] = useState((user as any)?.firstName || "");
  const [editLastName, setEditLastName] = useState((user as any)?.lastName || "");
  const fullName = [editFirstName, editLastName].filter(Boolean).join(" ") || user?.name || "";
  const [phone, setPhone] = useState(user?.phone || "");

  const [payToName, setPayToName] = useState("");
  const [ein, setEin] = useState("");
  const [w9OnFile, setW9OnFile] = useState(false);
  const [agreementSigned, setAgreementSigned] = useState(false);

  const [paymentMethod, setPaymentMethod] = useState<string>("");
  const [bankName, setBankName] = useState("");
  const [bankRoutingNumber, setBankRoutingNumber] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankAccountType, setBankAccountType] = useState("checking");
  const [zelleContact, setZelleContact] = useState("");

  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [addressCity, setAddressCity] = useState("");
  const [addressState, setAddressState] = useState("");
  const [addressZip, setAddressZip] = useState("");
  const [addressCountry, setAddressCountry] = useState("US");

  const { data: myProjects } = useQuery<ProjectOption[]>({
    queryKey: ["/api/time-entries/my-projects"],
  });

  const workerType = (user as any)?.workerType || "INDEPENDENT";
  const isW2 = workerType === "W2_EMPLOYEE";

  const stepSequence: StepId[] = isW2
    ? ["profile", "address", "review"]
    : ["profile", "business", "payment", "address", "review"];

  const currentStep = stepSequence[stepIndex];
  const totalSteps = stepSequence.length;

  const profileValid = editFirstName.trim().length > 0;
  const einDigits = ein.replace(/\D/g, "");
  const einValid = einDigits.length === 0 || einDigits.length === 9;
  const businessValid = payToName.trim().length > 0 && einValid && w9OnFile && agreementSigned;
  const paymentValid = paymentMethod === "ACH"
    ? (bankName.trim().length > 0 && bankRoutingNumber.replace(/\D/g, "").length === 9 && bankAccountNumber.trim().length >= 4)
    : paymentMethod === "ZELLE"
      ? zelleContact.trim().length > 0
      : false;
  const addressValid = addressLine1.trim().length > 0 && addressCity.trim().length > 0 && addressState.length > 0 && addressZip.trim().length >= 5;

  const canProceed = useMemo(() => {
    if (currentStep === "profile") return profileValid;
    if (currentStep === "business") return businessValid;
    if (currentStep === "payment") return paymentValid;
    if (currentStep === "address") return addressValid;
    return true;
  }, [currentStep, profileValid, businessValid, paymentValid, addressValid]);

  if (!user) {
    return <Redirect to="/login?auth=required" />;
  }
  if ((user as any).onboardingComplete) {
    const role = (user as any)?.role;
    return <Redirect to={role === "ADMIN" ? "/getting-started" : "/"} />;
  }

  const handleFinish = async () => {
    setLoading(true);
    try {
      const mailingAddress = [addressLine1, addressLine2, `${addressCity}, ${addressState} ${addressZip}`, addressCountry].filter(Boolean).join("\n");
      const payload: Record<string, unknown> = {
        name: fullName,
        firstName: editFirstName,
        lastName: editLastName,
        phone: phone || null,
        mailingAddress,
        addressLine1,
        addressLine2: addressLine2 || null,
        addressCity,
        addressState,
        addressZip,
        addressCountry,
      };

      // Only include team member fields for 1099 / C2C
      if (!isW2) {
        payload.payToName = payToName;
        payload.ein = ein.replace(/\D/g, "");
        payload.legalName = payToName;
        payload.taxIdLast4 = ein.replace(/\D/g, "").slice(-4);
        payload.paymentMethod = paymentMethod;
        payload.bankName = paymentMethod === "ACH" ? bankName : null;
        payload.bankRoutingNumber = paymentMethod === "ACH" ? bankRoutingNumber.replace(/\D/g, "") : null;
        payload.bankAccountNumber = paymentMethod === "ACH" ? bankAccountNumber : null;
        payload.bankAccountType = paymentMethod === "ACH" ? bankAccountType : null;
        payload.zelleContact = paymentMethod === "ZELLE" ? zelleContact : null;
        payload.w9OnFile = w9OnFile;
        payload.agreementSigned = agreementSigned;
      }

      await apiRequest("PATCH", "/api/auth/complete-onboarding", payload);
      toast({ title: "Welcome aboard! Let's get started." });
      window.location.reload();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const stepIcons: Record<StepId, typeof User> = {
    profile: User,
    business: Building2,
    payment: CreditCard,
    address: MapPin,
    review: Rocket,
  };

  const stepLabels: Record<StepId, string> = {
    profile: "Profile",
    business: "Business",
    payment: "Payment",
    address: "Address",
    review: "Ready!",
  };

  const stepSubtitles: Record<StepId, string> = {
    profile: "Tell us a bit about yourself",
    business: "Your business entity information",
    payment: "How should we pay you?",
    address: isW2 ? "Your mailing address for tax documents (W-2)" : "Your mailing address for tax documents (1099)",
    review: "Review your information",
  };

  const isReview = currentStep === "review";

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "var(--gradient-hero)" }}>
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: "var(--gradient-brand)" }}>
            <Cherry className="w-9 h-9 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white" data-testid="text-onboarding-title">
            {isReview ? "You're all set!" : "Let's set up your account"}
          </h1>
          <p className="text-sm mt-2" style={{ color: "var(--mc-btn-secondary-text)" }}>
            {stepSubtitles[currentStep]}
          </p>
          <p className="text-xs mt-1" style={{ color: "var(--mc-text-muted)" }}>
            Step {stepIndex + 1} of {totalSteps}
          </p>
        </div>

        <div className="flex items-center justify-center gap-1.5 mb-6">
          {stepSequence.map((s, i) => {
            const StepIcon = stepIcons[s];
            const isActive = stepIndex === i;
            const isDone = stepIndex > i;
            return (
              <div key={i} className="flex items-center gap-1.5">
                {i > 0 && (
                  <div
                    className="w-6 h-0.5 rounded"
                    style={{ background: isDone ? "var(--mc-text-muted)" : "var(--mc-border)" }}
                  />
                )}
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center transition-all"
                  style={{
                    background: isActive ? "var(--mc-surface-hover)" : isDone ? "var(--mc-border)" : "var(--mc-surface)",
                    border: isActive ? "2px solid var(--mc-text-muted)" : "2px solid transparent",
                  }}
                  data-testid={`step-indicator-${i + 1}`}
                >
                  {isDone ? (
                    <Check className="w-4 h-4 text-white" />
                  ) : (
                    <StepIcon className="w-4 h-4" style={{ color: isActive ? "var(--mc-text)" : "var(--mc-text-muted)" }} />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "0 24px 64px rgba(0,0,0,0.25)" }}>
          <CardContent className="p-6">

            {currentStep === "profile" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label style={{ color: "var(--lux-text-secondary)" }}>Full Name *</Label>
                  <div className="grid grid-cols-2 gap-3">
                    <Input value={editFirstName} onChange={e => setEditFirstName(e.target.value)} placeholder="First name" data-testid="input-onboard-firstName" style={{ background: "var(--color-surface-3)", borderColor: "var(--color-border-1)" }} />
                    <Input value={editLastName} onChange={e => setEditLastName(e.target.value)} placeholder="Last name" data-testid="input-onboard-lastName" style={{ background: "var(--color-surface-3)", borderColor: "var(--color-border-1)" }} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label style={{ color: "var(--lux-text-secondary)" }}>Phone Number</Label>
                  <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="(area code) prefix-line" data-testid="input-onboard-phone" style={{ background: "var(--color-surface-3)", borderColor: "var(--color-border-1)" }} />
                </div>
                {isW2 && (
                  <div className="rounded-lg px-4 py-3 mt-2" style={{ background: "rgba(59,130,246,0.05)", border: "1px solid rgba(59,130,246,0.15)" }}>
                    <p className="text-xs" style={{ color: "#3b82f6" }}>
                      As a W-2 employee, your compensation is handled through payroll. We just need your profile and mailing address.
                    </p>
                  </div>
                )}
              </div>
            )}

            {currentStep === "business" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label style={{ color: "var(--lux-text-secondary)" }}>Pay-To Name / Business Entity *</Label>
                  <Input value={payToName} onChange={e => setPayToName(e.target.value)} placeholder="e.g. Smith Consulting LLC" data-testid="input-onboard-pay-to" style={{ background: "var(--color-surface-3)", borderColor: "var(--color-border-1)" }} />
                  <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>The name on your checks or ACH payments</p>
                </div>
                <div className="space-y-2">
                  <Label style={{ color: "var(--lux-text-secondary)" }}>EIN (Employer Identification Number)</Label>
                  <Input value={ein} onChange={e => setEin(formatEin(e.target.value))} placeholder="XX-XXXXXXX" maxLength={10} data-testid="input-onboard-ein" style={{ background: "var(--color-surface-3)", borderColor: "var(--color-border-1)" }} />
                  <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>9-digit IRS employer identification number</p>
                </div>
                <div className="pt-3 space-y-3" style={{ borderTop: "1px solid var(--lux-border)" }}>
                  <div className="flex items-start gap-3">
                    <Checkbox id="w9-check" checked={w9OnFile} onCheckedChange={(v) => setW9OnFile(!!v)} data-testid="checkbox-w9" className="mt-0.5" />
                    <Label htmlFor="w9-check" className="text-sm cursor-pointer leading-relaxed" style={{ color: "var(--lux-text)" }}>
                      I confirm that I have a completed W-9 form on file or will provide one before my first payment. *
                    </Label>
                  </div>
                  <div className="flex items-start gap-3">
                    <Checkbox id="agreement-check" checked={agreementSigned} onCheckedChange={(v) => setAgreementSigned(!!v)} data-testid="checkbox-agreement" className="mt-0.5" />
                    <Label htmlFor="agreement-check" className="text-sm cursor-pointer leading-relaxed" style={{ color: "var(--lux-text)" }}>
                      I acknowledge that I am an independent team member and not an employee of the engaging firm. I understand that I am responsible for my own taxes, insurance, and benefits. *
                    </Label>
                  </div>
                </div>
              </div>
            )}

            {currentStep === "payment" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label style={{ color: "var(--lux-text-secondary)" }}>Preferred Payment Method *</Label>
                  <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                    <SelectTrigger data-testid="select-payment-method" style={{ background: "var(--color-surface-3)", borderColor: "var(--color-border-1)" }}>
                      <SelectValue placeholder="Choose payment method" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ACH">ACH Direct Deposit</SelectItem>
                      <SelectItem value="ZELLE">Zelle</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {paymentMethod === "ACH" && (
                  <div className="space-y-4 pt-2" style={{ borderTop: "1px solid var(--lux-border)" }}>
                    <p className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>ACH DIRECT DEPOSIT DETAILS</p>
                    <div className="space-y-2">
                      <Label style={{ color: "var(--lux-text-secondary)" }}>Bank Name *</Label>
                      <Input value={bankName} onChange={e => setBankName(e.target.value)} placeholder="e.g. Chase, Bank of America" data-testid="input-onboard-bank-name" style={{ background: "var(--color-surface-3)", borderColor: "var(--color-border-1)" }} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label style={{ color: "var(--lux-text-secondary)" }}>Routing Number *</Label>
                        <Input value={bankRoutingNumber} onChange={e => setBankRoutingNumber(formatRoutingNumber(e.target.value))} placeholder="9 digits" maxLength={9} data-testid="input-onboard-routing" style={{ background: "var(--color-surface-3)", borderColor: bankRoutingNumber && bankRoutingNumber.replace(/\D/g, "").length !== 9 ? "#ef4444" : "var(--color-border-1)" }} />
                        {bankRoutingNumber && bankRoutingNumber.replace(/\D/g, "").length !== 9 && (
                          <p className="text-xs" style={{ color: "#ef4444" }} data-testid="text-routing-error">Routing number must be exactly 9 digits</p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label style={{ color: "var(--lux-text-secondary)" }}>Account Number *</Label>
                        <Input value={bankAccountNumber} onChange={e => setBankAccountNumber(e.target.value)} placeholder="Account number" data-testid="input-onboard-account" style={{ background: "var(--color-surface-3)", borderColor: bankAccountNumber && (bankAccountNumber.replace(/\D/g, "").length < 4 || bankAccountNumber.replace(/\D/g, "").length > 17) ? "#ef4444" : "var(--color-border-1)" }} />
                        {bankAccountNumber && (bankAccountNumber.replace(/\D/g, "").length < 4 || bankAccountNumber.replace(/\D/g, "").length > 17) && (
                          <p className="text-xs" style={{ color: "#ef4444" }} data-testid="text-account-error">Account number must be 4–17 digits</p>
                        )}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label style={{ color: "var(--lux-text-secondary)" }}>Account Type *</Label>
                      <Select value={bankAccountType} onValueChange={setBankAccountType}>
                        <SelectTrigger data-testid="select-account-type" style={{ background: "var(--color-surface-3)", borderColor: "var(--color-border-1)" }}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="checking">Checking</SelectItem>
                          <SelectItem value="savings">Savings</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
                {paymentMethod === "ZELLE" && (
                  <div className="space-y-4 pt-2" style={{ borderTop: "1px solid var(--lux-border)" }}>
                    <p className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>ZELLE PAYMENT DETAILS</p>
                    <div className="space-y-2">
                      <Label style={{ color: "var(--lux-text-secondary)" }}>Zelle Email or Phone *</Label>
                      <Input value={zelleContact} onChange={e => setZelleContact(e.target.value)} placeholder="email@example.com or phone number" data-testid="input-onboard-zelle" style={{ background: "var(--color-surface-3)", borderColor: "var(--color-border-1)" }} />
                      <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>The email or phone number registered with your Zelle account</p>
                    </div>
                  </div>
                )}
                {!paymentMethod && (
                  <p className="text-xs text-center py-4" style={{ color: "var(--lux-text-muted)" }}>Select a payment method to continue</p>
                )}
              </div>
            )}

            {currentStep === "address" && (
              <div className="space-y-4">
                <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
                  {isW2 ? "Used for tax documents (W-2) and physical mail" : "Used for tax documents (1099) and physical mail"}
                </p>
                <div className="space-y-2">
                  <Label style={{ color: "var(--lux-text-secondary)" }}>Street Address *</Label>
                  <Input value={addressLine1} onChange={e => setAddressLine1(e.target.value)} placeholder="123 Main Street" data-testid="input-onboard-address1" style={{ background: "var(--color-surface-3)", borderColor: "var(--color-border-1)" }} />
                </div>
                <div className="space-y-2">
                  <Label style={{ color: "var(--lux-text-secondary)" }}>Suite / Apt / Unit</Label>
                  <Input value={addressLine2} onChange={e => setAddressLine2(e.target.value)} placeholder="Suite 200 (optional)" data-testid="input-onboard-address2" style={{ background: "var(--color-surface-3)", borderColor: "var(--color-border-1)" }} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label style={{ color: "var(--lux-text-secondary)" }}>City *</Label>
                    <Input value={addressCity} onChange={e => setAddressCity(e.target.value)} placeholder="Dallas" data-testid="input-onboard-city" style={{ background: "var(--color-surface-3)", borderColor: "var(--color-border-1)" }} />
                  </div>
                  <div className="space-y-2">
                    <Label style={{ color: "var(--lux-text-secondary)" }}>State *</Label>
                    <Select value={addressState} onValueChange={setAddressState}>
                      <SelectTrigger data-testid="select-onboard-state" style={{ background: "var(--color-surface-3)", borderColor: "var(--color-border-1)" }}><SelectValue placeholder="State" /></SelectTrigger>
                      <SelectContent>{US_STATES.map(s => (<SelectItem key={s} value={s}>{s}</SelectItem>))}</SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label style={{ color: "var(--lux-text-secondary)" }}>ZIP Code *</Label>
                    <Input value={addressZip} onChange={e => setAddressZip(e.target.value.replace(/[^\d-]/g, "").slice(0, 10))} placeholder="75201" maxLength={10} data-testid="input-onboard-zip" style={{ background: "var(--color-surface-3)", borderColor: "var(--color-border-1)" }} />
                  </div>
                  <div className="space-y-2">
                    <Label style={{ color: "var(--lux-text-secondary)" }}>Country</Label>
                    <Input value={addressCountry} onChange={e => setAddressCountry(e.target.value)} placeholder="US" data-testid="input-onboard-country" style={{ background: "var(--color-surface-3)", borderColor: "var(--color-border-1)" }} />
                  </div>
                </div>
              </div>
            )}

            {currentStep === "review" && (
              <div className="space-y-4">
                <div className="space-y-3">
                  <div className="rounded-lg px-4 py-3" style={{ background: "var(--lux-surface-alt)" }}>
                    <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "var(--lux-text-muted)" }}>Profile</p>
                    <p className="text-sm font-medium" style={{ color: "var(--lux-text)" }}>{fullName}</p>
                    {phone && <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>{phone}</p>}
                  </div>

                  {!isW2 && (
                    <div className="rounded-lg px-4 py-3" style={{ background: "var(--lux-surface-alt)" }}>
                      <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "var(--lux-text-muted)" }}>Business Entity</p>
                      <p className="text-sm font-medium" style={{ color: "var(--lux-text)" }}>{payToName}</p>
                      <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>{ein ? <>EIN: {ein} &bull; </> : null}W-9: &#10003; &bull; Agreement: &#10003;</p>
                    </div>
                  )}

                  {!isW2 && (
                    <div className="rounded-lg px-4 py-3" style={{ background: "var(--lux-surface-alt)" }}>
                      <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "var(--lux-text-muted)" }}>Payment</p>
                      {paymentMethod === "ACH" ? (
                        <>
                          <p className="text-sm font-medium" style={{ color: "var(--lux-text)" }}>ACH Direct Deposit</p>
                          <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
                            {bankName} &bull; {bankAccountType} &bull;&bull;&bull;&bull;{bankAccountNumber.slice(-4)}
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="text-sm font-medium" style={{ color: "var(--lux-text)" }}>Zelle</p>
                          <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>{zelleContact}</p>
                        </>
                      )}
                    </div>
                  )}

                  <div className="rounded-lg px-4 py-3" style={{ background: "var(--lux-surface-alt)" }}>
                    <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "var(--lux-text-muted)" }}>Mailing Address</p>
                    <p className="text-sm" style={{ color: "var(--lux-text)" }}>
                      {addressLine1}{addressLine2 ? `, ${addressLine2}` : ""}
                    </p>
                    <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
                      {addressCity}, {addressState} {addressZip} {addressCountry}
                    </p>
                  </div>

                  {myProjects && myProjects.length > 0 ? (
                    <div className="rounded-lg px-4 py-3" style={{ background: "var(--lux-surface-alt)" }}>
                      <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "var(--lux-text-muted)" }}>Assigned Projects</p>
                      {myProjects.map(p => (
                        <div key={p.id} className="flex items-center gap-2 py-1" data-testid={`project-card-${p.id}`}>
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: getProjectColor(p.id) }} />
                          <span className="text-sm" style={{ color: "var(--lux-text)" }}>{p.name}</span>
                          <span className="text-xs" style={{ color: "var(--lux-text-muted)" }}>({p.clientName})</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-center py-2" style={{ color: "var(--lux-text-muted)" }}>
                      No projects assigned yet — your admin will add you to projects soon.
                    </p>
                  )}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between mt-6 pt-4" style={{ borderTop: "1px solid var(--lux-border)" }}>
              {stepIndex > 0 ? (
                <Button variant="ghost" onClick={() => setStepIndex(stepIndex - 1)} data-testid="button-onboard-back">
                  <ArrowLeft className="w-4 h-4 mr-1" /> Back
                </Button>
              ) : (
                <div />
              )}
              {!isReview ? (
                <Button
                  className="text-white"
                  style={{ background: canProceed ? "var(--gradient-brand)" : undefined }}
                  onClick={() => setStepIndex(stepIndex + 1)}
                  disabled={!canProceed}
                  data-testid="button-onboard-next"
                >
                  Next <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              ) : (
                <Button
                  className="text-white"
                  style={{ background: "var(--gradient-brand)" }}
                  onClick={handleFinish}
                  disabled={loading}
                  data-testid="button-onboard-finish"
                >
                  <Rocket className="w-4 h-4 mr-1" />
                  {loading ? "Finishing..." : "Go to Dashboard"}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}