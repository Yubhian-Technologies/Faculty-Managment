"use client";

import { Label } from "@/components/ui/label";
import { DocumentUploadField } from "@/components/shared/DocumentUploadField";

export interface FacultyDocumentsValue {
  joiningLetterUrl?: string;
  appointmentLetterUrl?: string;
  resumeUrl?: string;
}

interface Props {
  facultyId: string;
  value: FacultyDocumentsValue;
  onChange: (next: FacultyDocumentsValue) => void;
}

// Documents module editor - carved out of the old single-page faculty edit
// form so it can be its own module page (see FacultyProfileModuleEditor).
export function FacultyDocumentsFields({ facultyId, value, onChange }: Props) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">Upload signed copies of the joining letter, appointment order, and resume/CV for this record.</p>
      <div className="space-y-2">
        <Label>Joining Letter</Label>
        <DocumentUploadField
          label="Joining Letter"
          value={value.joiningLetterUrl || undefined}
          uploadEndpoint="/api/upload/faculty-document"
          extraFields={{ facultyId, docType: "joining-letter" }}
          onUploaded={(url) => onChange({ ...value, joiningLetterUrl: url })}
          onRemoved={() => onChange({ ...value, joiningLetterUrl: "" })}
        />
      </div>
      <div className="space-y-2">
        <Label>Appointment Letter</Label>
        <DocumentUploadField
          label="Appointment Letter"
          value={value.appointmentLetterUrl || undefined}
          uploadEndpoint="/api/upload/faculty-document"
          extraFields={{ facultyId, docType: "appointment-letter" }}
          onUploaded={(url) => onChange({ ...value, appointmentLetterUrl: url })}
          onRemoved={() => onChange({ ...value, appointmentLetterUrl: "" })}
        />
      </div>
      <div className="space-y-2">
        <Label>Resume / CV</Label>
        <DocumentUploadField
          label="Resume / CV"
          value={value.resumeUrl || undefined}
          uploadEndpoint="/api/upload/faculty-document"
          extraFields={{ facultyId, docType: "resume" }}
          onUploaded={(url) => onChange({ ...value, resumeUrl: url })}
          onRemoved={() => onChange({ ...value, resumeUrl: "" })}
        />
      </div>
    </div>
  );
}
