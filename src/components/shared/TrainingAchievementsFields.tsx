"use client";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NumInput, TextInput, RepeatingGroup } from "@/components/shared/ProfileFieldPrimitives";
import { CertificateUploadField } from "@/components/shared/CertificateUploadField";
import { TRAINING_ENTRY_TYPE_LABELS, AWARD_CATEGORY_LABELS } from "@/types";
import type { TrainingEntry, TrainingEntryType, AwardEntry, AwardCategory } from "@/types";

// Shared by Technical and Non-Technical staff profile fields (Faculty and
// Supporting Staff) - same Training/Achievements shape (TrainingEntry[]/
// AwardEntry[] from core.ts) reused across both.

const EMPTY_TRAINING: TrainingEntry = { type: "WORKSHOP", title: "", organizer: "", year: new Date().getFullYear() };
const EMPTY_AWARD: AwardEntry = { category: "APPRECIATION_CERTIFICATE", title: "", awardingBody: "", year: new Date().getFullYear() };

export function TrainingGroup({ items, onChange }: { items: TrainingEntry[] | undefined; onChange: (v: TrainingEntry[]) => void }) {
  return (
    <RepeatingGroup
      title="Training"
      items={items}
      empty={EMPTY_TRAINING}
      onChange={onChange}
      renderRow={(item, update) => (
        <>
          <div className="space-y-2">
            <Label>Type</Label>
            <Select value={item.type} onValueChange={(v) => update({ type: v as TrainingEntryType })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(TRAINING_ENTRY_TYPE_LABELS).map(([k, label]) => (
                  <SelectItem key={k} value={k}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <TextInput label="Title" value={item.title} onChange={(v) => update({ title: v })} />
          <TextInput label="Organizer" value={item.organizer} onChange={(v) => update({ organizer: v })} />
          <NumInput label="Year" value={item.year} onChange={(v) => update({ year: v })} />
          <NumInput label="Duration (days)" value={item.durationDays} onChange={(v) => update({ durationDays: v })} />
          <div className="sm:col-span-2">
            <Label className="text-xs">Certificate</Label>
            <CertificateUploadField
              value={item.certificateUrl}
              onUploaded={(url) => update({ certificateUrl: url })}
              onRemoved={() => update({ certificateUrl: "" })}
            />
          </div>
        </>
      )}
    />
  );
}

export function AchievementsGroup({ items, onChange }: { items: AwardEntry[] | undefined; onChange: (v: AwardEntry[]) => void }) {
  return (
    <RepeatingGroup
      title="Achievements / Awards"
      items={items}
      empty={EMPTY_AWARD}
      onChange={onChange}
      renderRow={(item, update) => (
        <>
          <div className="space-y-2">
            <Label>Category</Label>
            <Select value={item.category} onValueChange={(v) => update({ category: v as AwardCategory })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(AWARD_CATEGORY_LABELS).map(([k, label]) => (
                  <SelectItem key={k} value={k}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <TextInput label="Title" value={item.title} onChange={(v) => update({ title: v })} />
          <TextInput label="Awarding Body" value={item.awardingBody} onChange={(v) => update({ awardingBody: v })} />
          <NumInput label="Year" value={item.year} onChange={(v) => update({ year: v })} />
          <div className="sm:col-span-2">
            <Label className="text-xs">Certificate</Label>
            <CertificateUploadField
              value={item.certificateUrl}
              onUploaded={(url) => update({ certificateUrl: url })}
              onRemoved={() => update({ certificateUrl: "" })}
            />
          </div>
        </>
      )}
    />
  );
}
