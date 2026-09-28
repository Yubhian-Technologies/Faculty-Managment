"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Shield,
  ShieldCheck,
  UserCheck,
  Users,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import type { LocationDepartment, LocationStaffMember } from "@/types/locationStaff";

interface LocationUserOption {
  uid: string;
  name: string;
  email: string;
  phone?: string;
  role: string;
}

export default function EditDepartmentPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [department, setDepartment] = useState<LocationDepartment | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");

  const [headType, setHeadType] = useState<"staff" | "user">("staff");
  const [selectedStaffId, setSelectedStaffId] = useState<string>("__none__");
  const [selectedUserUid, setSelectedUserUid] = useState<string>("__none__");
  const [headName, setHeadName] = useState("");
  const [headPhone, setHeadPhone] = useState("");
  const [headEmail, setHeadEmail] = useState("");

  const [createLogin, setCreateLogin] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [createdCredentials, setCreatedCredentials] = useState<{
    headName: string;
    email: string;
    password: string;
    deptName: string;
  } | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const [staffList, setStaffList] = useState<LocationStaffMember[]>([]);
  const [users, setUsers] = useState<LocationUserOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let isCancelled = false;
    Promise.all([
      fetch(`/api/location/departments`)
        .then((r) => (r.ok ? r.json() : Promise.resolve({ departments: [] })))
        .then((d) => (d.departments as LocationDepartment[] | undefined) ?? []),
      fetch(`/api/location/staff?status=ALL`)
        .then((r) => (r.ok ? r.json() : Promise.resolve({ staff: [] })))
        .then((d) => (d.staff as LocationStaffMember[] | undefined) ?? []),
      fetch(`/api/location/users`)
        .then((r) => (r.ok ? r.json() : Promise.resolve({ users: [] })))
        .then((d) => (d.users as LocationUserOption[] | undefined) ?? []),
    ])
      .then(([departments, staff, userList]) => {
        if (isCancelled) return;
        setStaffList(staff);
        setUsers(userList);

        const dept = departments.find((d) => d.id === params.id) ?? null;
        setDepartment(dept);
        if (!dept) return;

        setName(dept.name);
        setCode(dept.code || "");
        setDescription(dept.description || "");
        setHeadName(dept.headName || "");
        setHeadEmail(dept.headEmail || "");
        setHeadPhone(dept.headPhone || "");

        const matchedStaff = dept.headStaffId
          ? staff.find((s) => s.id === dept.headStaffId)
          : staff.find((s) => s.id === dept.headUid || s.name === dept.headName);

        if (matchedStaff) {
          setHeadType("staff");
          setSelectedStaffId(matchedStaff.id);
          if (matchedStaff.userUid && matchedStaff.userEmail) {
            setLoginEmail(matchedStaff.userEmail);
          }
        } else if (dept.headUid && userList.some((u) => u.uid === dept.headUid)) {
          setHeadType("user");
          setSelectedUserUid(dept.headUid);
        }
      })
      .catch(() => {
        if (!isCancelled) toast({ variant: "destructive", title: "Failed to load department" });
      })
      .finally(() => {
        if (!isCancelled) setIsLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [params.id]);

  const handleStaffSelect = (staffId: string) => {
    setSelectedStaffId(staffId);
    if (staffId === "__none__") {
      setHeadName("");
      setHeadPhone("");
      setHeadEmail("");
      setLoginEmail("");
      setLoginPassword("");
      setCreateLogin(false);
    } else {
      const staff = staffList.find((s) => s.id === staffId);
      if (staff) {
        setHeadName(staff.name);
        setHeadPhone(staff.contactNumber);
        if (staff.userUid && staff.userEmail) {
          setHeadEmail(staff.userEmail);
          setLoginEmail(staff.userEmail);
          setCreateLogin(false);
        } else {
          const cleanPhone = (staff.contactNumber || "").replace(/\D/g, "");
          const cleanName = staff.name.toLowerCase().replace(/[^a-z0-9]/g, "");
          const suggestedEmail = cleanPhone ? `${cleanPhone}@campus.local` : `${cleanName || "head"}@campus.local`;
          setHeadEmail(suggestedEmail);
          setLoginEmail(suggestedEmail);
          setLoginPassword("");
          setCreateLogin(true);
        }
      }
    }
  };

  const handleUserSelect = (uid: string) => {
    setSelectedUserUid(uid);
    setCreateLogin(false);
    if (uid === "__none__") {
      setHeadName("");
      setHeadPhone("");
      setHeadEmail("");
      setLoginEmail("");
      setLoginPassword("");
    } else {
      const u = users.find((user) => user.uid === uid);
      if (u) {
        setHeadName(u.name);
        setHeadEmail(u.email);
        setHeadPhone(u.phone || "");
        setLoginEmail(u.email);
      }
    }
  };

  const handleCopy = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    toast({ title: "Copied to clipboard", description: text });
    setTimeout(() => setCopiedField(null), 2500);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast({ variant: "destructive", title: "Department name is required" });
      return;
    }

    if (headType === "staff" && selectedStaffId !== "__none__" && createLogin) {
      if (!loginEmail.trim() || !loginEmail.includes("@")) {
        toast({ variant: "destructive", title: "Valid login email required for Department Head" });
        return;
      }
      if (!loginPassword.trim() || loginPassword.trim().length < 6) {
        toast({ variant: "destructive", title: "Password must be at least 6 characters" });
        return;
      }
    }

    setIsSubmitting(true);
    try {
      let resolvedHeadUid: string | null = null;
      let resolvedHeadStaffId: string | null = null;

      if (headType === "staff" && selectedStaffId !== "__none__") {
        resolvedHeadStaffId = selectedStaffId;
        resolvedHeadUid = selectedStaffId;
      } else if (headType === "user" && selectedUserUid !== "__none__") {
        resolvedHeadUid = selectedUserUid;
      }

      const payload: Record<string, unknown> = {
        name: name.trim(),
        code: code.trim().toUpperCase(),
        description: description.trim(),
        headStaffId: resolvedHeadStaffId,
        headUid: resolvedHeadUid,
        headName: headName.trim() || null,
        headPhone: headPhone.trim() || null,
        headEmail: (createLogin ? loginEmail.trim() : headEmail.trim()) || null,
      };

      if (headType === "staff" && selectedStaffId !== "__none__" && createLogin) {
        payload.loginCredentials = {
          email: loginEmail.trim(),
          password: loginPassword.trim(),
        };
      }

      const res = await fetch(`/api/location/departments/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update department");

      toast({ title: "Department Updated", description: `Successfully updated "${name}".` });

      if (data.credentialsCreated) {
        setCreatedCredentials({
          headName: headName.trim(),
          email: loginEmail.trim(),
          password: loginPassword.trim(),
          deptName: name.trim(),
        });
      } else {
        router.push("/location-staff-admin/departments");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update department";
      toast({ variant: "destructive", title: "Update Failed", description: msg });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-3xl mx-auto pb-24 md:pb-8">
        <div className="h-16 rounded-xl border bg-card/60 animate-pulse" />
        <div className="h-96 rounded-xl border bg-card/60 animate-pulse" />
      </div>
    );
  }

  if (!department) {
    return (
      <div className="space-y-4 max-w-3xl mx-auto pb-24 md:pb-8">
        <div className="rounded-xl border border-dashed p-8 text-center bg-card/30">
          <p className="font-semibold text-foreground text-sm">Department not found</p>
          <Button asChild size="sm" variant="outline" className="mt-3 text-xs rounded-full">
            <Link href="/location-staff-admin/departments">Back to Departments</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-3xl mx-auto pb-24 md:pb-8">
      {/* ── Top Header ── */}
      <div className="flex items-center gap-3 bg-card p-4 rounded-xl border">
        <Button asChild variant="ghost" size="icon" className="h-9 w-9 shrink-0">
          <Link href="/location-staff-admin/departments">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-foreground">Edit Department</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Update department details and its supervising Department Head.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* ── Department Details Card ── */}
        <Card className="border-border/80 shadow-xs">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" />
              <span>Department Information</span>
            </CardTitle>
            <CardDescription className="text-xs">
              Basic identification and classification details.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-2 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2 space-y-1">
                <Label className="text-xs font-semibold">Department Name *</Label>
                <Input
                  required
                  placeholder="e.g. Security, Housekeeping, Electrical, Transport"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold">
                  Department Code <span className="text-muted-foreground font-normal">(Optional)</span>
                </Label>
                <Input
                  placeholder="e.g. SEC, HSK (Optional)"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  className="h-9 text-xs font-mono"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold">Description / Scope of Work</Label>
              <Textarea
                rows={3}
                placeholder="Operational responsibilities, coverage zones, shift schedules..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="text-xs"
              />
            </div>
          </CardContent>
        </Card>

        {/* ── Department Head Assignment Card ── */}
        <Card className="border-border/80 shadow-xs">
          <CardHeader className="p-4 pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Shield className="h-4 w-4 text-primary" />
                  <span>Assign Department Head</span>
                </CardTitle>
                <CardDescription className="text-xs">
                  Choose a staff member from your staff registry to supervise this department.
                </CardDescription>
              </div>

              <div className="flex items-center gap-1 bg-muted p-0.5 rounded-lg text-xs">
                <Button
                  type="button"
                  size="sm"
                  variant={headType === "staff" ? "default" : "ghost"}
                  onClick={() => {
                    setHeadType("staff");
                    handleStaffSelect(selectedStaffId);
                  }}
                  className="h-7 text-[11px] px-2.5 rounded-md"
                >
                  <Users className="h-3 w-3 mr-1" />
                  From Staff
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={headType === "user" ? "default" : "ghost"}
                  onClick={() => {
                    setHeadType("user");
                    handleUserSelect(selectedUserUid);
                  }}
                  className="h-7 text-[11px] px-2.5 rounded-md"
                >
                  <UserCheck className="h-3 w-3 mr-1" />
                  From Users
                </Button>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-4 pt-2 space-y-3">
            {headType === "staff" && (
              <div className="space-y-2">
                <Label className="text-xs font-semibold">Select Staff Member</Label>
                <Select value={selectedStaffId} onValueChange={handleStaffSelect}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Select staff member to lead this department" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value="__none__">None (Leave Unassigned for now)</SelectItem>
                    {staffList.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name} — {s.role} ({s.contactNumber})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {headType === "user" && (
              <div className="space-y-2">
                <Label className="text-xs font-semibold">Select Location User</Label>
                <Select value={selectedUserUid} onValueChange={handleUserSelect}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Choose a system user account" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value="__none__">None (Leave Unassigned)</SelectItem>
                    {users.map((u) => (
                      <SelectItem key={u.uid} value={u.uid}>
                        {u.name} ({u.role}) — {u.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="p-3 bg-muted/30 rounded-xl border border-border/60 space-y-2">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
                Department Head Contact Details
              </span>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">Full Name</Label>
                  <Input placeholder="Head Name" value={headName} onChange={(e) => setHeadName(e.target.value)} className="h-8 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">Contact Phone</Label>
                  <Input placeholder="Head Phone" type="tel" value={headPhone} onChange={(e) => setHeadPhone(e.target.value)} className="h-8 text-xs" />
                </div>
              </div>

              {headType === "user" && selectedUserUid !== "__none__" && (
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">User Email</Label>
                  <Input placeholder="Head Email" type="email" value={headEmail} disabled className="h-8 text-xs bg-muted/50" />
                </div>
              )}

              {headName && (
                <div className="mt-2 flex items-center gap-2">
                  <Badge variant="outline" className="text-[11px] bg-primary/10 text-primary border-primary/20">
                    Selected Head: {headName} {headPhone && `(${headPhone})`}
                  </Badge>
                </div>
              )}
            </div>

            {headType === "staff" && selectedStaffId !== "__none__" && (
              <div className="mt-3">
                {(() => {
                  const staff = staffList.find((s) => s.id === selectedStaffId);
                  if (staff?.userUid && staff?.userEmail) {
                    return (
                      <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-700 dark:text-emerald-400">
                        <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-500" />
                        <div>
                          <p className="font-semibold">Portal Account Active</p>
                          <p className="text-[11px] opacity-90">
                            This staff member already has login credentials: <strong>{staff.userEmail}</strong>.
                          </p>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div className="p-3.5 bg-primary/5 rounded-xl border border-primary/20 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <KeyRound className="h-4 w-4 text-primary shrink-0" />
                          <div>
                            <p className="text-xs font-bold text-foreground">Create Department Head Login Account</p>
                            <p className="text-[11px] text-muted-foreground">
                              Generate login credentials for the portal (role: LOCATION_DEPT_HEAD).
                            </p>
                          </div>
                        </div>
                        <Switch checked={createLogin} onCheckedChange={setCreateLogin} aria-label="Toggle Head Login Creation" />
                      </div>

                      {createLogin && (
                        <div className="space-y-3 pt-2 border-t border-primary/10">
                          <div className="space-y-1">
                            <Label className="text-[11px] font-semibold">Login Email *</Label>
                            <Input
                              type="email"
                              required
                              placeholder="head@campus.local"
                              value={loginEmail}
                              onChange={(e) => setLoginEmail(e.target.value)}
                              className="h-8 text-xs bg-background"
                            />
                          </div>

                          <div className="space-y-1">
                            <Label className="text-[11px] font-semibold">Password *</Label>
                            <div className="relative">
                              <Input
                                type={showPassword ? "text" : "password"}
                                required
                                placeholder="Enter password (min 6 characters)"
                                value={loginPassword}
                                onChange={(e) => setLoginPassword(e.target.value)}
                                className="h-8 text-xs font-mono pr-8 bg-background"
                              />
                              <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
                              >
                                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button asChild type="button" variant="outline" size="sm">
            <Link href="/location-staff-admin/departments">Cancel</Link>
          </Button>
          <Button type="submit" size="sm" disabled={isSubmitting} className="px-5">
            {isSubmitting ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </form>

      {/* ── Created Credentials Dialog (info reveal, not a form) ── */}
      <Dialog
        open={!!createdCredentials}
        onOpenChange={(open) => {
          if (!open) {
            setCreatedCredentials(null);
            router.push("/location-staff-admin/departments");
          }
        }}
      >
        <DialogContent className="max-w-md p-5">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2 text-primary">
              <KeyRound className="h-5 w-5" />
              Department Head Credentials Created!
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Login account has been created for <strong>{createdCredentials?.headName}</strong> for the <strong>{createdCredentials?.deptName}</strong> department.
            </DialogDescription>
          </DialogHeader>

          <div className="p-3 bg-muted/40 rounded-xl border space-y-2.5 my-2">
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-background border">
              <div>
                <span className="text-[10px] uppercase font-bold text-muted-foreground block">Login Email</span>
                <span className="text-xs font-mono font-medium text-foreground">{createdCredentials?.email}</span>
              </div>
              <Button type="button" size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => handleCopy(createdCredentials?.email || "", "email")}>
                {copiedField === "email" ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                {copiedField === "email" ? "Copied" : "Copy"}
              </Button>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-lg bg-background border">
              <div>
                <span className="text-[10px] uppercase font-bold text-muted-foreground block">Password</span>
                <span className="text-xs font-mono font-medium text-foreground">{createdCredentials?.password}</span>
              </div>
              <Button type="button" size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => handleCopy(createdCredentials?.password || "", "password")}>
                {copiedField === "password" ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                {copiedField === "password" ? "Copied" : "Copy"}
              </Button>
            </div>

            <div className="text-[11px] text-muted-foreground bg-primary/5 p-2 rounded-lg border border-primary/10">
              Role: <strong className="text-foreground">LOCATION_DEPT_HEAD</strong>. They can immediately log in at <code className="text-xs">/login</code> to manage staff and attendance.
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                const credsText = `Department: ${createdCredentials?.deptName}\nHead: ${createdCredentials?.headName}\nLogin Email: ${createdCredentials?.email}\nPassword: ${createdCredentials?.password}\nRole: Location Dept Head`;
                handleCopy(credsText, "all");
              }}
            >
              {copiedField === "all" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
              {copiedField === "all" ? "All Copied!" : "Copy Full Details"}
            </Button>

            <Button
              type="button"
              size="sm"
              onClick={() => {
                setCreatedCredentials(null);
                router.push("/location-staff-admin/departments");
              }}
            >
              Done & View Departments
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
