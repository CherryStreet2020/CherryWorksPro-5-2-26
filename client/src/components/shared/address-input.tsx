import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState, useEffect } from "react";

export interface AddressFields {
  line1: string;
  line2: string;
  city: string;
  state: string;
  postal: string;
  country: string;
}

export const emptyAddress: AddressFields = { line1: "", line2: "", city: "", state: "", postal: "", country: "" };

export function parseAddress(address: string): AddressFields {
  const result = { ...emptyAddress };
  if (!address) return result;

  const parts = address.split(",").map((s) => s.trim());
  if (parts.length >= 1) result.line1 = parts[0];
  if (parts.length >= 6) {
    result.line2 = parts[1];
    result.city = parts[2];
    result.state = parts[3];
    result.country = parts[4];
    result.postal = parts[5];
  } else if (parts.length >= 5) {
    result.city = parts[1];
    result.state = parts[2];
    result.country = parts[3];
    result.postal = parts[4];
  } else if (parts.length >= 4) {
    result.city = parts[1];
    result.state = parts[2];
    result.country = parts[3];
  } else if (parts.length >= 3) {
    result.city = parts[1];
    result.state = parts[2];
  } else if (parts.length === 2) {
    result.city = parts[1];
  }
  return result;
}

export function combineAddress(fields: AddressFields): string {
  const parts = [fields.line1, fields.line2, fields.city, fields.state, fields.country, fields.postal].filter(Boolean);
  return parts.join(", ");
}

interface AddressInputProps {
  value?: string;
  fields?: AddressFields;
  onChange?: (combined: string) => void;
  onFieldsChange?: (fields: AddressFields) => void;
}

export function AddressInput({ value, fields: fieldsProp, onChange, onFieldsChange }: AddressInputProps) {
  const [fields, setFields] = useState<AddressFields>(() => fieldsProp || parseAddress(value || ""));

  useEffect(() => {
    if (fieldsProp) {
      setFields(fieldsProp);
    } else if (value !== undefined) {
      setFields(parseAddress(value));
    }
  }, [fieldsProp?.line1, fieldsProp?.line2, fieldsProp?.city, fieldsProp?.state, fieldsProp?.postal, fieldsProp?.country, value]);

  function update(key: keyof AddressFields, val: string) {
    const next = { ...fields, [key]: val };
    setFields(next);
    if (onFieldsChange) onFieldsChange(next);
    if (onChange) onChange(combineAddress(next));
  }

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Address Line 1</Label>
        <Input value={fields.line1} onChange={(e) => update("line1", e.target.value)} data-testid="input-address-line1" />
      </div>
      <div>
        <Label className="text-xs">Address Line 2 (optional)</Label>
        <Input value={fields.line2} onChange={(e) => update("line2", e.target.value)} data-testid="input-address-line2" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">City</Label>
          <Input value={fields.city} onChange={(e) => update("city", e.target.value)} data-testid="input-address-city" />
        </div>
        <div>
          <Label className="text-xs">State / Province</Label>
          <Input value={fields.state} onChange={(e) => update("state", e.target.value)} data-testid="input-address-state" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Postal Code</Label>
          <Input value={fields.postal} onChange={(e) => update("postal", e.target.value)} data-testid="input-address-postal" />
        </div>
        <div>
          <Label className="text-xs">Country</Label>
          <Input value={fields.country} onChange={(e) => update("country", e.target.value)} data-testid="input-address-country" />
        </div>
      </div>
    </div>
  );
}
