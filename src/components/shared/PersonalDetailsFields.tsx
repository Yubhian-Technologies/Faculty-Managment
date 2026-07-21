"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;

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
  passportNumber?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  ratificationStatus?: string;
  ratificationDate?: string;   // yyyy-mm-dd
  maritalStatus?: string;
  spouseName?: string;
  numberOfChildren?: number;
  referral?: string;
  nativePlace?: string;
  temporaryAddress?: string;
  permanentSameAsTemporary?: boolean;
  permanentAddress?: string;
  bloodGroup?: string;
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
        <div className="space-y-2">
          <Label>Passport No</Label>
          <Input
            value={value.passportNumber ?? ""}
            onChange={(e) => set("passportNumber", e.target.value.toUpperCase())}
            placeholder="N1234567"
            className="uppercase"
          />
        </div>
        <div className="space-y-2">
          <Label>Referral (if any)</Label>
          <Input value={value.referral ?? ""} onChange={(e) => set("referral", e.target.value)} placeholder="Name of referring person/source" />
        </div>
      </div>

      <div className="pt-2 pb-1 border-t">
        <p className="text-sm font-medium text-muted-foreground">Family &amp; Other Details</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Marital Status</Label>
          <Select value={value.maritalStatus ?? ""} onValueChange={(v) => set("maritalStatus", v)}>
            <SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Single">Single</SelectItem>
              <SelectItem value="Married">Married</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Blood Group</Label>
          <Select value={value.bloodGroup ?? ""} onValueChange={(v) => set("bloodGroup", v)}>
            <SelectTrigger><SelectValue placeholder="Select blood group" /></SelectTrigger>
            <SelectContent>
              {BLOOD_GROUPS.map((bg) => <SelectItem key={bg} value={bg}>{bg}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {value.maritalStatus === "Married" && (
          <>
            <div className="space-y-2">
              <Label>Spouse Name</Label>
              <Input value={value.spouseName ?? ""} onChange={(e) => set("spouseName", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Number of Children</Label>
              <Input
                type="number"
                min={0}
                value={value.numberOfChildren ?? ""}
                onChange={(e) => set("numberOfChildren", e.target.value === "" ? undefined : Number(e.target.value))}
              />
            </div>
          </>
        )}
        <div className="space-y-2">
          <Label>Native Place</Label>
          <Input value={value.nativePlace ?? ""} onChange={(e) => set("nativePlace", e.target.value)} />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Temporary Address</Label>
        <Textarea value={value.temporaryAddress ?? ""} onChange={(e) => set("temporaryAddress", e.target.value)} />
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id="permanentSameAsTemporary"
          checked={value.permanentSameAsTemporary ?? false}
          onCheckedChange={(checked) => set("permanentSameAsTemporary", checked === true)}
        />
        <Label htmlFor="permanentSameAsTemporary" className="cursor-pointer font-normal">
          Permanent address same as temporary
        </Label>
      </div>
      {!value.permanentSameAsTemporary && (
        <div className="space-y-2">
          <Label>Permanent Address</Label>
          <Textarea value={value.permanentAddress ?? ""} onChange={(e) => set("permanentAddress", e.target.value)} />
        </div>
      )}

      <div className="pt-2 pb-1 border-t">
        <p className="text-sm font-medium text-muted-foreground">Emergency Contact</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Emergency Contact Name</Label>
          <Input value={value.emergencyContactName ?? ""} onChange={(e) => set("emergencyContactName", e.target.value)} placeholder="Name of contact person" />
        </div>
        <div className="space-y-2">
          <Label>Emergency Contact Phone</Label>
          <Input value={value.emergencyContactPhone ?? ""} onChange={(e) => set("emergencyContactPhone", e.target.value)} placeholder="+91 98765 43210" />
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
