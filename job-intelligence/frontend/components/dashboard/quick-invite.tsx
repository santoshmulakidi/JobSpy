"use client";

import { Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function QuickInvite() {
  return (
    <Card className="surface shadow-none">
      <CardHeader>
        <CardTitle>Quick invite</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            toast.success("Invite queued");
          }}
        >
          <Input type="email" placeholder="teammate@example.com" aria-label="Invite email" />
          <Button type="submit" size="icon" aria-label="Send invite">
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
