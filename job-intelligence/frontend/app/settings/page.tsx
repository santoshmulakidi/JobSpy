"use client";

import { useEffect, useState } from "react";

import { CheckCircle2, Eye, EyeOff, Key, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const API_BASE = process.env.NEXT_PUBLIC_JOB_API_URL ?? "http://127.0.0.1:8000";

type KeyStatus = { set: boolean; masked: string | null };
type ApiKeyState = {
  gemini_keys: { slot: number; set: boolean; masked: string | null }[];
  groq_key: KeyStatus;
  groq_model: string;
  openrouter_key: KeyStatus;
  openrouter_model: string;
  nvidia_key: KeyStatus;
  nvidia_model: string;
};

function KeyInput({
  label,
  placeholder,
  current,
  value,
  onChange,
}: {
  label: string;
  placeholder?: string;
  current: KeyStatus | null;
  value: string;
  onChange: (v: string) => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <p className="text-xs font-medium">{label}</p>
        {current?.set && (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            <CheckCircle2 className="h-2.5 w-2.5 mr-0.5 text-green-500" />
            {current.masked}
          </Badge>
        )}
      </div>
      <div className="relative">
        <Input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={current?.set ? "Leave blank to keep existing" : (placeholder ?? "Paste new key")}
          className="pr-9 font-mono text-xs"
        />
        <button
          type="button"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          onClick={() => setShow((s) => !s)}
        >
          {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [remote, setRemote] = useState<ApiKeyState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Editable values — blank = keep existing
  const [geminiKeys, setGeminiKeys] = useState<string[]>(["", "", "", "", ""]);
  const [groqKey, setGroqKey] = useState("");
  const [groqModel, setGroqModel] = useState("");
  const [openrouterKey, setOpenrouterKey] = useState("");
  const [nvidiaKey, setNvidiaKey] = useState("");
  const [nvidiaModel, setNvidiaModel] = useState("");

  useEffect(() => {
    fetch(`${API_BASE}/settings/api-keys`)
      .then((r) => r.json())
      .then((d: ApiKeyState) => {
        setRemote(d);
        setGroqModel(d.groq_model ?? "");
        setNvidiaModel(d.nvidia_model ?? "");
      })
      .catch(() => toast.error("Could not load key status"))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        gemini_keys: geminiKeys.map((k) => k.trim() || null),
        groq_key: groqKey.trim() || null,
        groq_model: groqModel.trim() || null,
        openrouter_key: openrouterKey.trim() || null,
        nvidia_key: nvidiaKey.trim() || null,
        nvidia_model: nvidiaModel.trim() || null,
      };
      const res = await fetch(`${API_BASE}/settings/api-keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      toast.success(data.message ?? "Saved");
      // Clear inputs after save
      setGeminiKeys(["", "", "", "", ""]);
      setGroqKey("");
      setOpenrouterKey("");
      setNvidiaKey("");
      // Refresh status
      const fresh = await fetch(`${API_BASE}/settings/api-keys`).then((r) => r.json());
      setRemote(fresh);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <p className="text-sm text-muted-foreground">Settings</p>
          <h1 className="mt-1 text-3xl font-medium tracking-tight">API Keys</h1>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading key status…
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">

            {/* Gemini */}
            <Card className="surface shadow-none">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Key className="h-4 w-4 text-primary" /> Gemini (Google AI)
                </CardTitle>
                <CardDescription>Up to 5 keys — rotated automatically on 429/503 errors. Free tier: 500 req/day per key.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {[0, 1, 2, 3, 4].map((i) => (
                  <KeyInput
                    key={i}
                    label={`Key ${i + 1}`}
                    current={remote?.gemini_keys[i] ?? null}
                    value={geminiKeys[i] ?? ""}
                    onChange={(v) => setGeminiKeys((prev) => { const n = [...prev]; n[i] = v; return n; })}
                  />
                ))}
              </CardContent>
            </Card>

            <div className="space-y-4">
              {/* Groq */}
              <Card className="surface shadow-none">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Key className="h-4 w-4 text-primary" /> Groq
                  </CardTitle>
                  <CardDescription>Fast free inference. Fallback after Gemini.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <KeyInput label="API Key" current={remote?.groq_key ?? null} value={groqKey} onChange={setGroqKey} />
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium">Model</p>
                    <Input value={groqModel} onChange={(e) => setGroqModel(e.target.value)} className="font-mono text-xs" placeholder="llama-4-maverick-17b-128e-instruct" />
                  </div>
                </CardContent>
              </Card>

              {/* OpenRouter */}
              <Card className="surface shadow-none">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Key className="h-4 w-4 text-primary" /> OpenRouter
                  </CardTitle>
                  <CardDescription>Access to Claude, GPT-4o, Qwen, Llama and more. Fallback #3.</CardDescription>
                </CardHeader>
                <CardContent>
                  <KeyInput label="API Key" current={remote?.openrouter_key ?? null} value={openrouterKey} onChange={setOpenrouterKey} />
                </CardContent>
              </Card>

              {/* NVIDIA */}
              <Card className="surface shadow-none">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Key className="h-4 w-4 text-primary" /> NVIDIA NIM
                  </CardTitle>
                  <CardDescription>Free hosted inference via NVIDIA API catalog. Fallback #4.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <KeyInput label="API Key" current={remote?.nvidia_key ?? null} value={nvidiaKey} onChange={setNvidiaKey} placeholder="nvapi-..." />
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium">Model</p>
                    <Input value={nvidiaModel} onChange={(e) => setNvidiaModel(e.target.value)} className="font-mono text-xs" placeholder="meta/llama-3.1-8b-instruct" />
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {!loading && (
          <div className="flex items-center gap-3">
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Save keys
            </Button>
            <p className="text-xs text-muted-foreground">
              Keys are written to <code className="font-mono">.env</code> on disk. Leave a field blank to keep the existing value.
            </p>
          </div>
        )}
      </div>
    </AppShell>
  );
}
