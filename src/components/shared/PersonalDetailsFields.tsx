"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface PersonalDetailsValue {
  gender?: string;
  dateOfBirth?: string;        // yyyy-mm-dd, for <input type="date">
  legalName?: string;
  fatherName?: string;
  motherName?: string;
  religion?: string;
  caste?: string;
  aadharNo?: string;
  panNo?: string;
  ratificationStatus?: string;
  ratificationDate?: string;   // yyyy-mm-dd
}

interface Props {
  value: PersonalDetailsValue;
  onChange: (next: PersonalDetailsValue) => void;
}

export function PersonalDetailsFields({ value, onChange }: Props) {
  function set<K extends keyof PersonalDetailsValue>(key: K, v: PersonalDetailsValue[K]) {
    onChange({ ...value, [key]: v });
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Gender</Label>
          <Select value={value.gender ?? ""} onValueChange={(v) => set("gender", v)}>
            <SelectTrigger><SelectValue placeholder="Select gender" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Male">Male</SelectItem>
              <SelectItem value="Female">Female</SelectItem>
              <SelectItem value="Other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Date of Birth</Label>
          <Input type="date" value={value.dateOfBirth ?? ""} onChange={(e) => set("dateOfBirth", e.target.value)} />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Legal Name (as per SSC)</Label>
        <Input
          value={value.legalName ?? ""}
          onChange={(e) => set("legalName", e.target.value.toUpperCase())}
          placeholder="FULL NAME IN CAPITALS"
          className="uppercase"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Father / Husband Name</Label>
          <Input value={value.fatherName ?? ""} onChange={(e) => set("fatherName", e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Mother Name</Label>
          <Input value={value.motherName ?? ""} onChange={(e) => set("motherName", e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Religion</Label>
          <Input value={value.religion ?? ""} onChange={(e) => set("religion", e.target.value)} placeholder="e.g. Hindu" />
        </div>
        <div className="space-y-2">
          <Label>Caste</Label>
          <Input value={value.caste ?? ""} onChange={(e) => set("caste", e.target.value)} placeholder="e.g. OC, BC-B" />
        </div>
        <div className="space-y-2">
          <Label>Aadhar No</Label>
          <Input
            value={value.aadharNo ?? ""}
            onChange={(e) => set("aadharNo", e.target.value)}
            placeholder="1234 5678 9012"
            maxLength={14}
          />
        </div>
        <div className="space-y-2">
          <Label>PAN No</Label>
          <Input
            value={value.panNo ?? ""}
            onChange={(e) => set("panNo", e.target.value.toUpperCase())}
            placeholder="ABCDE1234F"
            maxLength={10}
            className="uppercase"
          />
        </div>
      </div>

      <div className="pt-2 pb-1 border-t">
        <p className="text-sm font-medium text-muted-foreground">Ratification</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Ratification Status</Label>
          <Select value={value.ratificationStatus ?? ""} onValueChange={(v) => set("ratificationStatus", v)}>
            <SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Ratified">Ratified</SelectItem>
              <SelectItem value="Not Ratified">Not Ratified</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Ratification Date</Label>
          <Input type="date" value={value.ratificationDate ?? ""} onChange={(e) => set("ratificationDate", e.target.value)} />
        </div>
      </div>
    </div>
  );
}
