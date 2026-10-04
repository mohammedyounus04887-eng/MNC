import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface Props {
    onSubmit: (data: { title: string; message: string; expiresAt: Date | null }) => void;
    isLoading: boolean;
}

export default function AnnouncementForm({ onSubmit, isLoading }: Props) {
    const [title, setTitle] = useState("");
    const [message, setMessage] = useState("");
    const [expiresAt, setExpiresAt] = useState("");

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSubmit({ title, message, expiresAt: expiresAt ? new Date(expiresAt) : null });
        setTitle(""); setMessage(""); setExpiresAt("");
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
                <Label>Title *</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Announcement title" required />
            </div>
            <div className="space-y-2">
                <Label>Message *</Label>
                <Textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Write your announcement…" rows={4} required />
            </div>
            <div className="space-y-2">
                <Label>Expires At (optional)</Label>
                <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            </div>
            <Button type="submit" disabled={isLoading || !title || !message} className="w-full">
                {isLoading ? "Posting…" : "Post Announcement"}
            </Button>
        </form>
    );
}
