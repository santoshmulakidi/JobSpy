"use client";

import { ArrowLeft, Save, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getJob, parseResume } from "@/lib/api";
import { defaultProfiles, loadProfiles, saveProfiles, type JobProfile } from "@/lib/job-profiles";

function bufferToBase64(buffer: ArrayBuffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export default function ResumeLabPage() {
  const router = useRouter();
  const [profiles, setProfiles] = useState<JobProfile[]>(defaultProfiles);
  const [profileId, setProfileId] = useState("dotnet");
  const [resumeText, setResumeText] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [jobContext, setJobContext] = useState("No job selected");
  const [returnTo, setReturnTo] = useState<string | null>(null);

  const activeProfile = profiles.find((profile) => profile.id === profileId) ?? profiles[0];

  useEffect(() => {
    const storedProfiles = loadProfiles();
    setProfiles(storedProfiles);
    setProfileId(storedProfiles[0]?.id ?? "dotnet");
    setResumeText(storedProfiles[0]?.baseResume ?? "");

    async function loadJobContext() {
      const params = new URLSearchParams(window.location.search);
      const jobId = Number(params.get("jobId"));
      const stored = window.sessionStorage.getItem("resumeLabJob");
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as {
            id?: number;
            title?: string;
            company?: string | null;
            location?: string | null;
            description?: string;
            returnTo?: string;
          };
          if (!jobId || parsed.id === jobId) {
            setJobDescription(parsed.description ?? "");
            setJobContext(`${parsed.title ?? "Selected job"}${parsed.company ? ` at ${parsed.company}` : ""}${parsed.location ? ` | ${parsed.location}` : ""}`);
            setReturnTo(parsed.returnTo ?? "/jobs");
            return;
          }
        } catch {
          window.sessionStorage.removeItem("resumeLabJob");
        }
      }

      if (jobId) {
        try {
          const job = await getJob(jobId);
          setJobDescription(job.description ?? "");
          setJobContext(`${job.title}${job.company_name ? ` at ${job.company_name}` : ""}${job.location ? ` | ${job.location}` : ""}`);
          setReturnTo("/jobs");
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Could not load job description");
        }
      }
    }

    void loadJobContext();
  }, []);

  function updateActiveProfile(values: Partial<JobProfile>) {
    setProfiles((current) => current.map((profile) => (
      profile.id === profileId ? { ...profile, ...values } : profile
    )));
  }

  function selectProfile(nextProfileId: string) {
    const nextProfile = profiles.find((profile) => profile.id === nextProfileId);
    setProfileId(nextProfileId);
    setResumeText(nextProfile?.baseResume ?? "");
  }

  function createProfile() {
    const name = window.prompt("Profile name");
    if (!name?.trim()) return;
    const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;
    const nextProfile: JobProfile = {
      id,
      name: name.trim(),
      searchTerm: "",
      locations: "United States, Remote",
      preferredTitles: [],
      skills: [],
      baseResume: "",
    };
    const nextProfiles = [...profiles, nextProfile];
    setProfiles(nextProfiles);
    setProfileId(id);
    setResumeText("");
    saveProfiles(nextProfiles);
    toast.success("Profile created");
  }

  function saveActiveProfile() {
    const nextProfiles = profiles.map((profile) => (
      profile.id === profileId ? { ...profile, baseResume: resumeText } : profile
    ));
    setProfiles(nextProfiles);
    saveProfiles(nextProfiles);
    toast.success("Profile saved");
  }

  async function importResume(file: File | undefined) {
    if (!file) return;
    try {
      const text = bufferToBase64(await file.arrayBuffer());
      const result = await parseResume(file.name, text);
      setResumeText(result.text);
      updateActiveProfile({ baseResume: result.text });
      toast.success("Resume imported");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Resume import failed");
    }
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <p className="text-sm text-muted-foreground">Resume Lab</p>
          <h1 className="mt-1 text-3xl font-medium tracking-tight">Tailor resume and review credibility</h1>
          {returnTo ? (
            <Button className="mt-3" variant="outline" onClick={() => router.push(returnTo)}>
              <ArrowLeft className="h-4 w-4" /> Back to selected job
            </Button>
          ) : null}
        </div>
        <Card className="surface shadow-none">
          <CardHeader>
            <CardTitle>Profile and base resume</CardTitle>
            <CardDescription>Store separate resume and job preferences for each person/profile.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-[220px_1fr_auto]">
              <Select value={profileId} onValueChange={selectProfile}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {profiles.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>{profile.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground hover:bg-muted">
                <Upload className="h-4 w-4" /> Attach resume
                <input className="sr-only" type="file" accept=".docx,.txt" onChange={(event) => importResume(event.target.files?.[0])} />
              </label>
              <Button variant="outline" onClick={createProfile}>New profile</Button>
            </div>
            {activeProfile ? (
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2 text-sm font-medium">
                  Target search
                  <Input value={activeProfile.searchTerm} onChange={(event) => updateActiveProfile({ searchTerm: event.target.value })} placeholder=".NET developer or Java developer" />
                </label>
                <label className="space-y-2 text-sm font-medium">
                  Location preferences
                  <Input value={activeProfile.locations} onChange={(event) => updateActiveProfile({ locations: event.target.value })} placeholder="United States, Remote, Dallas, TX" />
                </label>
                <label className="space-y-2 text-sm font-medium md:col-span-2">
                  Preferred titles
                  <Textarea value={activeProfile.preferredTitles.join("\n")} onChange={(event) => updateActiveProfile({ preferredTitles: event.target.value.split("\n").map((item) => item.trim()).filter(Boolean) })} className="min-h-36" />
                </label>
              </div>
            ) : null}
            <Textarea value={resumeText} onChange={(event) => setResumeText(event.target.value)} placeholder="Upload or paste your base resume..." className="min-h-96" />
            <div className="flex flex-wrap gap-2">
              <Button onClick={saveActiveProfile}><Save className="h-4 w-4" /> Save profile</Button>
              <Button variant="outline" onClick={() => navigator.clipboard.writeText(resumeText)}>Copy resume text</Button>
            </div>
          </CardContent>
        </Card>
        <Card className="surface shadow-none">
          <CardHeader>
            <CardTitle>Job description</CardTitle>
            <CardDescription>{jobContext}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              value={jobDescription}
              onChange={(event) => setJobDescription(event.target.value)}
              placeholder="Open a job from the Jobs page or paste a job description here..."
              className="min-h-80"
            />
            <Button variant="outline" onClick={() => navigator.clipboard.writeText(jobDescription)}>Copy job description</Button>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
