import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export default function SettingsPage() {
  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <p className="text-sm text-muted-foreground">Settings</p>
          <h1 className="mt-1 text-3xl font-medium tracking-tight">Profile and workflow preferences</h1>
        </div>
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <Card className="surface shadow-none">
            <CardHeader>
              <CardTitle>Job profile</CardTitle>
              <CardDescription>Used for matching, Resume Lab, and application prioritization.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Input defaultValue=".NET Developer, Java Developer, Software Engineer" aria-label="Target roles" />
              <Input defaultValue="C#, .NET, Java, SQL, Azure, React" aria-label="Skills" />
              <Input defaultValue="Remote, United States, Dallas, TX" aria-label="Preferred locations" />
              <Select defaultValue="remote">
                <SelectTrigger><SelectValue placeholder="Work mode" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="remote">Remote first</SelectItem>
                  <SelectItem value="hybrid">Hybrid ok</SelectItem>
                  <SelectItem value="onsite">On-site ok</SelectItem>
                </SelectContent>
              </Select>
              <Textarea defaultValue="Prioritize senior engineering roles with visa-friendly companies and clear product ownership." aria-label="Notes" />
              <Button className="w-fit">Save preferences</Button>
            </CardContent>
          </Card>
          <Card className="surface shadow-none">
            <CardHeader>
              <CardTitle>Automation</CardTitle>
              <CardDescription>Production defaults for refresh and retention.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-muted-foreground">
              <p>Active jobs remain visible for 24 hours.</p>
              <p>Unapplied jobs are deleted after 7 days.</p>
              <p>Applied jobs are preserved in Applications.</p>
              <Button variant="outline" className="w-full">Review scheduler</Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
