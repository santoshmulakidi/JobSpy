import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const channels = [
  { label: "LinkedIn", value: 42 },
  { label: "Indeed", value: 26 },
  { label: "Career pages", value: 18 },
  { label: "Remote boards", value: 14 },
];

export function ChannelBars() {
  return (
    <Card className="surface shadow-none">
      <CardHeader>
        <CardTitle>Traffic by source</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {channels.map((channel) => (
          <div key={channel.label} className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>{channel.label}</span>
              <span className="text-muted-foreground">{channel.value}%</span>
            </div>
            <div className="h-2 rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${channel.value}%` }} />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
