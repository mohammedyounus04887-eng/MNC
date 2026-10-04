"use client";

import { useState } from "react";
import { Avatar } from "@/components/Avatar";
import ProfileForm from "@/components/ProfileForm";

export default function ProfileSection({
  name,
  city,
  photoUrl,
  phoneDisplay,
}: {
  name: string;
  city: string;
  photoUrl: string | null;
  phoneDisplay: string;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <section className="rounded-2xl bg-surface p-5">
        <h2 className="mb-4 font-semibold">Edit profile</h2>
        <ProfileForm
          mode="edit"
          initialName={name}
          initialCity={city}
          initialPhotoUrl={photoUrl}
          onDone={() => setEditing(false)}
        />
      </section>
    );
  }

  return (
    <section className="flex items-center gap-4 rounded-2xl bg-surface p-5">
      <Avatar name={name} photoUrl={photoUrl} size={64} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-lg font-semibold">{name}</p>
        <p className="truncate text-sm text-text-dim">
          {city}
          {city ? " · " : ""}
          {phoneDisplay}
        </p>
      </div>
      <button
        onClick={() => setEditing(true)}
        className="h-12 rounded-xl border border-hairline px-4 font-medium"
      >
        Edit
      </button>
    </section>
  );
}
