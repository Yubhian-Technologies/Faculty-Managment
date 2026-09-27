"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  Check,
  Copy,
  Edit2,
  Eye,
  EyeOff,
  KeyRound,
  Plus,
  Search,
  Shield,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import type { LocationDepartment, LocationStaffMember } from "@/types/locationStaff";

interface LocationUserOption {
  uid: string;
  name: string;
  email: string;
  phone?: string;
  role: string;
}

export default function LocationDepartmentsPage() {
  const [departments, setDepartments] = useState<LocationDepartment[]>([]);
  const [users, setUsers] = useState<LocationUserOption[]>([]);
  const [staffList, setStaffList] = useState<LocationStaffMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Create / Edit modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDept, setEditingDept] = useState<LocationDepartment | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Delete confirmation state
  const [deptToDelete, setDeptToDelete] = useState<LocationDepartment | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Form Fields
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [headType, setHeadType] = useState<"staff" | "user">("staff");
  const [headStaffId, setHeadStaffId] = useState<string>("__none__");
  const [headUid, setHeadUid] = useState<string>("__none__");
  const [headName, setHeadName] = useState("");
  const [headEmail, setHeadEmail] = useState("");
  const [headPhone, setHeadPhone] = useState("");

  // Login credentials state for department head assignment
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

  const [refreshKey, setRefreshKey] = useState(0);
  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  const handleCopy = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    toast({ title: "Copied to clipboard", description: text });
    setTimeout(() => setCopiedField(null), 2500);
  };

  useEffect(() => {
    let isCancelled = false;
    Promise.all([
      fetch(`/api/location/departments`)
        .then((r) => (r.ok ? r.json() : Promise.resolve({ departments: [] })))
        .then((d) => {
          if (!isCancelled) setDepartments(d.departments ?? []);
        }),
      fetch(`/api/location/users`)
        .then((r) => (r.ok ? r.json() : Promise.resolve({ users: [] })))
        .then((d) => {
          if (!isCancelled) setUsers(d.users ?? []);
        }),
      fetch(`/api/location/staff?status=ALL`)
        .then((r) => (r.ok ? r.json() : Promise.resolve({ staff: [] })))
        .then((d) => {
          if (!isCancelled) setStaffList(d.staff ?? []);
        }),
    ])
      .catch(() => {
        if (!isCancelled) toast({ variant: "destructive", title: "Failed to load departments" });
      })
      .finally(() => {
        if (!isCancelled) setIsLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [refreshKey]);

  const openEditModal = (dept: LocationDepartment) => {
    setEditingDept(dept);
    setName(dept.name);
    setCode(dept.code || "");
    setDescription(dept.description || "");

    const matchedStaff = dept.headStaffId
      ? staffList.find((s) => s.id === dept.headStaffId)
      : staffList.find((s) => s.id === dept.headUid || s.name === dept.headName);

    if (matchedStaff) {
      setHeadType("staff");
      setHeadStaffId(matchedStaff.id);
      setHeadUid(matchedStaff.id);
      if (matchedStaff.userUid && matchedStaff.userEmail) {
        setCreateLogin(false);
        setLoginEmail(matchedStaff.userEmail);
      } else {
        const cleanPhone = (matchedStaff.contactNumber || "").replace(/\D/g, "");
        const cleanName = matchedStaff.name.toLowerCase().replace(/[^a-z0-9]/g, "");
        const suggestedEmail = cleanPhone
          ? `${cleanPhone}@campus.local`
          : `${cleanName || "head"}@campus.local`;
        setLoginEmail(suggestedEmail);
        setLoginPassword("");
        setCreateLogin(false);
      }
    } else if (dept.headUid && users.some((u) => u.uid === dept.headUid)) {
      setHeadType("user");
      setHeadStaffId("__none__");
      setHeadUid(dept.headUid);
      setCreateLogin(false);
    } else {
      setHeadType("staff");
      setHeadStaffId("__none__");
      setHeadUid(dept.headUid || "__none__");
      setCreateLogin(false);
    }

    setHeadName(dept.headName || "");
    setHeadEmail(dept.headEmail || "");
    setHeadPhone(dept.headPhone || "");
    setIsModalOpen(true);
  };

  const handleStaffHeadSelect = (staffId: string) => {
    setHeadStaffId(staffId);
    if (staffId === "__none__") {
      setHeadName("");
      setHeadEmail("");
      setHeadPhone("");
      setHeadUid("__none__");
      setCreateLogin(false);
      setLoginEmail("");
      setLoginPassword("");
    } else {
      const s = staffList.find((item) => item.id === staffId);
      if (s) {
        setHeadName(s.name);
        setHeadPhone(s.contactNumber);
        setHeadUid(s.id);
        if (s.userUid && s.userEmail) {
          setHeadEmail(s.userEmail);
          setLoginEmail(s.userEmail);
          setCreateLogin(false);
        } else {
          const cleanPhone = (s.contactNumber || "").replace(/\D/g, "");
          const cleanName = s.name.toLowerCase().replace(/[^a-z0-9]/g, "");
          const suggestedEmail = cleanPhone
            ? `${cleanPhone}@campus.local`
            : `${cleanName || "head"}@campus.local`;
          setHeadEmail(suggestedEmail);
          setLoginEmail(suggestedEmail);
          setLoginPassword("");
          setCreateLogin(true);
        }
      }
    }
  };

  const handleUserHeadSelect = (uid: string) => {
    setHeadUid(uid);
    setHeadStaffId("__none__");
    setCreateLogin(false);
    if (uid === "__none__") {
      setHeadName("");
      setHeadEmail("");
      setHeadPhone("");
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

  const handleDeleteDepartment = async () => {
    if (!deptToDelete) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/location/departments/${deptToDelete.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete department");

      toast({
        title: "Department Deleted",
        description: `"${deptToDelete.name}" has been removed.`,
      });
      setDeptToDelete(null);
      reload();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Delete failed";
      toast({ variant: "destructive", title: "Delete Failed", description: msg });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast({ variant: "destructive", title: "Department name is required" });
      return;
    }

    if (headType === "staff" && headStaffId !== "__none__" && createLogin) {
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

      if (headType === "staff" && headStaffId !== "__none__") {
        resolvedHeadStaffId = headStaffId;
        resolvedHeadUid = headStaffId;
      } else if (headType === "user" && headUid !== "__none__") {
        resolvedHeadUid = headUid;
      }

      const payload: Record<string, unknown> = {
        name: name.trim(),
        code: code.trim().toUpperCase(),
        description: description.trim(),
        headStaffId: resolvedHeadStaffId,
        headUid: resolvedHeadUid,
        headName: headName.trim() || null,
        headEmail: (createLogin ? loginEmail.trim() : headEmail.trim()) || null,
        headPhone: headPhone.trim() || null,
      };

      if (headType === "staff" && headStaffId !== "__none__" && createLogin) {
        payload.loginCredentials = {
          email: loginEmail.trim(),
          password: loginPassword.trim(),
        };
      }

      const url = editingDept
        ? `/api/location/departments/${editingDept.id}`
        : `/api/location/departments`;
      const method = editingDept ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save department");

      toast({
        title: "Success",
        description: editingDept ? "Department updated" : `Created department ${name}`,
      });
      setIsModalOpen(false);
      reload();

      if (data.credentialsCreated) {
        setCreatedCredentials({
          headName: headName.trim(),
          email: loginEmail.trim(),
          password: loginPassword.trim(),
          deptName: name.trim(),
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Save failed";
      toast({ variant: "destructive", title: "Save failed", description: msg });
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredDepts = departments.filter(
    (d) =>
      d.name.toLowerCase().includes(search.toLowerCase().trim()) ||
      d.code?.toLowerCase().includes(search.toLowerCase().trim()) ||
      d.headName?.toLowerCase().includes(search.toLowerCase().trim())
  );

  return (
    <div className="space-y-4 max-w-5xl mx-auto pb-24 md:pb-8">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-card p-4 rounded-xl border">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="h-9 w-9 shrink-0">
            <Link href="/location-staff-admin">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-lg sm:text-xl font-bold text-foreground">Location Departments</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Create departments and appoint Department Heads across the campus.
            </p>
          </div>
        </div>

        <Button
          size="sm"
          asChild
          className="rounded-full gap-1.5 h-9 text-xs font-semibold px-4 shadow-sm self-start sm:self-auto"
        >
          <Link href="/location-staff-admin/departments/new">
            <Plus className="h-4 w-4" />
            <span>New Department</span>
          </Link>
        </Button>
      </div>

      {/* ── Search Bar ── */}
      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by department name, code, or department head..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 h-9 text-xs rounded-xl bg-card"
        />
      </div>

      {/* ── Departments Grid ── */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-40 rounded-xl border bg-card/60 animate-pulse" />
          ))}
        </div>
      ) : filteredDepts.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center bg-card/30">
          <Building2 className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-50" />
          <p className="font-semibold text-foreground text-sm">No departments found</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Create departments such as Security, Housekeeping, Transport, or Electrical.
          </p>
          <Button size="sm" asChild variant="outline" className="mt-3 text-xs rounded-full">
            <Link href="/location-staff-admin/departments/new">
              Create First Department
            </Link>
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredDepts.map((dept) => (
            <Card key={dept.id} className="border-border/80 shadow-xs flex flex-col justify-between hover:border-primary/40 transition-colors">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-base text-foreground truncate">{dept.name}</h3>
                      {dept.code && (
                        <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0">
                          {dept.code}
                        </Badge>
                      )}
                    </div>
                    {dept.description && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{dept.description}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEditModal(dept)}
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      title="Edit Department"
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeptToDelete(dept)}
                      className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      title="Delete Department"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>

                {/* Assigned Department Head */}
                <div className="p-2.5 rounded-lg bg-muted/40 border border-border/50 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase flex items-center gap-1">
                      <Shield className="h-3 w-3 text-primary" />
                      <span>Department Head</span>
                    </span>
                    {dept.headUid ? (
                      <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px] px-1.5 py-0">
                        Assigned
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground text-[10px] px-1.5 py-0">
                        Unassigned
                      </Badge>
                    )}
                  </div>
                  {dept.headName ? (
                    <div>
                      <p className="font-bold text-foreground">{dept.headName}</p>
                      <p className="text-[11px] text-muted-foreground flex items-center gap-2 mt-0.5">
                        {dept.headEmail && <span>{dept.headEmail}</span>}
                        {dept.headPhone && <span>· {dept.headPhone}</span>}
                      </p>
                    </div>
                  ) : (
                    <p className="text-muted-foreground italic text-[11px]">No head assigned yet.</p>
                  )}
                </div>

                {/* Bottom stats & quick link */}
                <div className="pt-2 border-t border-border/50 flex items-center justify-between text-xs">
                  <span className="font-medium text-muted-foreground flex items-center gap-1">
                    <Users className="h-3.5 w-3.5" />
                    <span>{dept.staffCount ?? 0} Staff</span>
                  </span>

                  <Button asChild size="sm" variant="ghost" className="h-7 text-xs text-primary px-2">
                    <Link href={`/location-staff-admin/staff?departmentId=${dept.id}`}>
                      View Staff →
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ── Edit Department Modal ── */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-md p-5">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">
              {editingDept ? "Edit Department" : "Create Location Department"}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Define the department and appoint its supervising Department Head.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSave} className="space-y-3 pt-2">
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2 space-y-1">
                <Label className="text-xs font-semibold">Department Name *</Label>
                <Input
                  required
                  placeholder="e.g. Security, Housekeeping"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold">
                  Code <span className="text-muted-foreground font-normal">(Optional)</span>
                </Label>
                <Input
                  placeholder="e.g. SEC (Optional)"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  className="h-9 text-xs font-mono"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold">Description</Label>
              <Textarea
                rows={2}
                placeholder="Operational purpose, coverage area..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="text-xs"
              />
            </div>

            {/* Department Head Assignment Box */}
            <div className="p-3 bg-muted/20 rounded-xl border space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Shield className="h-3.5 w-3.5 text-primary" />
                  <span>Assign Department Head</span>
                </span>

                <div className="flex items-center gap-1 bg-muted p-0.5 rounded-lg border">
                  <button
                    type="button"
                    onClick={() => {
                      setHeadType("staff");
                      setHeadUid("__none__");
                    }}
                    className={`px-2 py-0.5 text-[11px] font-medium rounded-md transition-colors ${
                      headType === "staff" ? "bg-background text-foreground shadow-xs font-semibold" : "text-muted-foreground"
                    }`}
                  >
                    From Staff ({staffList.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setHeadType("user");
                      setHeadStaffId("__none__");
                    }}
                    className={`px-2 py-0.5 text-[11px] font-medium rounded-md transition-colors ${
                      headType === "user" ? "bg-background text-foreground shadow-xs font-semibold" : "text-muted-foreground"
                    }`}
                  >
                    From Users ({users.length})
                  </button>
                </div>
              </div>

              {headType === "staff" ? (
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">Select from Staff Directory</Label>
                  <Select value={headStaffId} onValueChange={handleStaffHeadSelect}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Choose staff member" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None (Leave Unassigned)</SelectItem>
                      {staffList.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name} ({s.role} - {s.departmentName || "Unassigned"})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">Select from registered users</Label>
                  <Select value={headUid} onValueChange={handleUserHeadSelect}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Choose a user" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None (Leave Unassigned)</SelectItem>
                      {users.map((u) => (
                        <SelectItem key={u.uid} value={u.uid}>
                          {u.name} ({u.role})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 pt-1">
                <Input
                  placeholder="Head Name"
                  value={headName}
                  onChange={(e) => setHeadName(e.target.value)}
                  className="h-8 text-xs"
                />
                <Input
                  placeholder="Head Phone"
                  type="tel"
                  value={headPhone}
                  onChange={(e) => setHeadPhone(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>

              {headType === "user" && headUid !== "__none__" && (
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">User Email</Label>
                  <Input
                    placeholder="Head Email"
                    type="email"
                    value={headEmail}
                    disabled
                    className="h-8 text-xs bg-muted/50"
                  />
                </div>
              )}

              {/* Login Credentials Section for Staff Head */}
              {headType === "staff" && headStaffId !== "__none__" && (
                <div className="pt-2 border-t">
                  {(() => {
                    const staff = staffList.find((s) => s.id === headStaffId);
                    if (staff?.userUid && staff?.userEmail) {
                      return (
                        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-700 dark:text-emerald-400">
                          <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-500" />
                          <div>
                            <p className="font-semibold">Portal Account Active</p>
                            <p className="text-[11px] opacity-90">
                              Active credentials: <strong>{staff.userEmail}</strong>
                            </p>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div className="p-3 bg-primary/5 rounded-xl border border-primary/20 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <KeyRound className="h-4 w-4 text-primary shrink-0" />
                            <div>
                              <p className="text-xs font-bold text-foreground">Create Head Login Account</p>
                              <p className="text-[10px] text-muted-foreground">
                                Portal credentials (LOCATION_DEPT_HEAD)
                              </p>
                            </div>
                          </div>
                          <Switch
                            checked={createLogin}
                            onCheckedChange={setCreateLogin}
                            aria-label="Toggle Head Login Creation"
                          />
                        </div>

                        {createLogin && (
                          <div className="space-y-2 pt-1 border-t border-primary/10">
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
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setIsModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={isSubmitting}>
                {isSubmitting ? "Saving..." : editingDept ? "Save Changes" : "Create Department"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Created Credentials Dialog ── */}
      <Dialog open={!!createdCredentials} onOpenChange={(open) => !open && setCreatedCredentials(null)}>
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
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1"
                onClick={() => handleCopy(createdCredentials?.email || "", "email")}
              >
                {copiedField === "email" ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                {copiedField === "email" ? "Copied" : "Copy"}
              </Button>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-lg bg-background border">
              <div>
                <span className="text-[10px] uppercase font-bold text-muted-foreground block">Password</span>
                <span className="text-xs font-mono font-medium text-foreground">{createdCredentials?.password}</span>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1"
                onClick={() => handleCopy(createdCredentials?.password || "", "password")}
              >
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
              onClick={() => setCreatedCredentials(null)}
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation Dialog ── */}
      <Dialog open={!!deptToDelete} onOpenChange={(open) => !open && setDeptToDelete(null)}>
        <DialogContent className="max-w-md p-5">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-destructive flex items-center gap-2">
              <Trash2 className="h-4 w-4" />
              Delete Department
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Are you sure you want to delete department &ldquo;{deptToDelete?.name}&rdquo;?
              This will unassign its Department Head. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="pt-2 gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDeptToDelete(null)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleDeleteDepartment}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting..." : "Delete Department"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
