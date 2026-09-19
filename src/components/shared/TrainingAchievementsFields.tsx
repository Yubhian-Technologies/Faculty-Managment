"use client";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NumInput, TextInput, DateInput, RepeatingGroup } from "@/components/shared/ProfileFieldPrimitives";
import { migrateAwardEntries, migrateTrainingEntries } from "@/lib/faculty/fieldRenames";
import { CertificateUploadField } from "@/components/shared/CertificateUploadField";
import { TRAINING_ENTRY_TYPE_LABELS, AWARD_CATEGORY_LABELS } from "@/types";
import type { TrainingEntry, TrainingEntryType, AwardEntry, AwardCategory } from "@/types";

// Shared by Technical and Non-Technical staff profile fields (Faculty and
// Supporting Staff) - same Training/Achievements shape (TrainingEntry[]/
// AwardEntry[] from core.ts) reused across both, under the same field names
// and labels as the Faculty forms (TrainingEntryFields / MentorshipFields).
//
// Both lists may still hold the legacy key names on an un-migrated doc, so
// each is lifted through the registry before it's rendered (and so every
// onChange emits only the current shape).

const EMPTY_TRAINING: TrainingEntry = { type: "WORKSHOP", titleOfTheProgram: "", nameOfTheFacultyCoordinator: "", year: new Date().getFullYear() };
const EMPTY_AWARD: AwardEntry = { category: "APPRECIATION_CERTIFICATE", titleOfAward: "", awardingAgencyBody: "" };

export function TrainingGroup({ items, onChange }: { items: TrainingEntry[] | undefined; onChange: (v: TrainingEntry[]) => void }) {
  return (
    <RepeatingGroup
      title="Training"
      items={migrateTrainingEntries(items) as TrainingEntry[] | undefined}
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
          <TextInput label="Title of the Program" value={item.titleOfTheProgram} onChange={(v) => update({ titleOfTheProgram: v })} />
          <TextInput label="Name of the Faculty / Coordinator" value={item.nameOfTheFacultyCoordinator} onChange={(v) => update({ nameOfTheFacultyCoordinator: v })} />
          <NumInput label="Year" value={item.year} onChange={(v) => update({ year: v })} />
          <NumInput label="Duration" value={item.duration} onChange={(v) => update({ duration: v })} />
          <div className="sm:col-span-2">
            <CertificateUploadField
              label="Certificate"
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
      items={migrateAwardEntries(items) as AwardEntry[] | undefined}
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
          <TextInput label="Title of Award" value={item.titleOfAward} onChange={(v) => update({ titleOfAward: v })} />
          <TextInput label="Awarding Agency/Body" value={item.awardingAgencyBody} onChange={(v) => update({ awardingAgencyBody: v })} />
          {/* Only dateOfAward is written - a legacy year-only record keeps its
              `year` untouched as a read-only fallback (see AwardEntry). */}
          <DateInput label="Date of Award" value={item.dateOfAward} onChange={(v) => update({ dateOfAward: v })} />
          <div className="sm:col-span-2">
            <CertificateUploadField
              label="Certificate"
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
